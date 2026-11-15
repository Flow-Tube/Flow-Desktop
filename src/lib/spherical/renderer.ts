import type { LookAt, Projection } from "./view";

const VERTEX = `
attribute vec2 a_pos;
varying vec2 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Each pixel's ray, turned by pitch then yaw, picks its colour from the equirectangular frame.
const FRAGMENT = `
precision highp float;
uniform sampler2D u_frame;
uniform float u_aspect;
uniform float u_tanHalfFov;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_vScale;
varying vec2 v_pos;
const float PI = 3.14159265358979;
void main() {
  vec3 dir = normalize(vec3(v_pos.x * u_tanHalfFov * u_aspect, v_pos.y * u_tanHalfFov, -1.0));
  float cp = cos(u_pitch);
  float sp = sin(u_pitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float cy = cos(u_yaw);
  float sy = sin(u_yaw);
  dir = vec3(dir.x * cy - dir.z * sy, dir.y, dir.x * sy + dir.z * cy);
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  uv.y *= u_vScale;
  gl_FragColor = texture2D(u_frame, uv);
}`;

const rad = (degrees: number) => (degrees * Math.PI) / 180;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** Draws a 360 video's current frame as the view from inside its sphere. */
export class SphericalRenderer {
  private readonly uniforms: Record<"aspect" | "tanHalfFov" | "yaw" | "pitch" | "vScale", WebGLUniformLocation | null>;
  private hasFrame = false;

  private constructor(
    private readonly gl: WebGLRenderingContext,
    program: WebGLProgram,
  ) {
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    // Video frames are rarely a power of two in size, which WebGL 1 only samples clamped and unmipped.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const at = (name: string) => gl.getUniformLocation(program, name);
    this.uniforms = { aspect: at("u_aspect"), tanHalfFov: at("u_tanHalfFov"), yaw: at("u_yaw"), pitch: at("u_pitch"), vScale: at("u_vScale") };
  }

  /** A renderer for `canvas`, or null where WebGL isn't available. */
  static create(canvas: HTMLCanvasElement): SphericalRenderer | null {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return new SphericalRenderer(gl, program);
  }

  /** Takes the video's current frame; false when it has none yet. */
  upload(video: HTMLVideoElement): boolean {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return this.hasFrame;
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    this.hasFrame = true;
    return true;
  }

  draw(look: LookAt, projection: Projection, width: number, height: number): void {
    if (!this.hasFrame || width === 0 || height === 0) return;
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.uniform1f(this.uniforms.aspect, width / height);
    gl.uniform1f(this.uniforms.tanHalfFov, Math.tan(rad(look.fov) / 2));
    gl.uniform1f(this.uniforms.yaw, rad(look.yaw));
    gl.uniform1f(this.uniforms.pitch, rad(look.pitch));
    gl.uniform1f(this.uniforms.vScale, projection === "equirectangular_top_bottom" ? 0.5 : 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

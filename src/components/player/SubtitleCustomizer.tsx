import React from "react";
import { usePlayerStore, DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from "../../store/usePlayerStore";
import { Undo2 } from "lucide-react";

const textColors = [
  "#FFFFFF", // White
  "#FFF59D", // Yellow
  "#80DEEA", // Cyan
  "#A5D6A7", // Green
  "#FFCC80", // Orange
  "#F8BBD0", // Pink
];

const backgroundColors = [
  "#000000", // Black
  "#1F2937", // Dark Gray
  "#263238", // Slate
  "#4E342E", // Brown
  "#102A43", // Navy
  "#37474F", // Blue Gray
];

export const SubtitleCustomizer: React.FC = () => {
  const subtitleStyle = usePlayerStore((s) => s.subtitleStyle);
  const setSubtitleStyle = usePlayerStore((s) => s.setSubtitleStyle);

  const handleUpdate = (updated: Partial<SubtitleStyle>) => {
    setSubtitleStyle({
      ...subtitleStyle,
      ...updated,
    });
  };

  const handleReset = () => {
    setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
  };

  const hex = (subtitleStyle.backgroundColor || "#000000").replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  const bgRgba = `rgba(${r}, ${g}, ${b}, ${subtitleStyle.backgroundOpacity})`;

  return (
    <div className="flex flex-col gap-4 p-1 select-none">
      {/* Live Preview Box */}
      <div className="relative flex flex-col justify-end items-center h-28 w-full rounded-lg bg-chrome-zinc-950/80 border border-chrome-white/5 overflow-hidden pattern-grid">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 text-[10px] text-chrome-zinc-500 font-mono">
          PREVIEW BOUNDS
        </div>
        <div
          className="mb-4 px-3 py-1.5 rounded text-center transition-all duration-150"
          style={{
            backgroundColor: bgRgba,
            color: subtitleStyle.textColor,
            fontSize: `${subtitleStyle.fontSize}px`,
            fontWeight: subtitleStyle.isBold ? "700" : "500",
            lineHeight: "1.35",
            boxShadow: "0 10px 25px -5px color-mix(in srgb, var(--color-chrome-black) 50%, transparent)",
          }}
        >
          Preview Subtitle
        </div>
      </div>

      {/* Font Size Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-xs font-semibold text-chrome-zinc-300">
          <span>Font Size</span>
          <span className="text-chrome-red-400 font-mono">{subtitleStyle.fontSize}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={32}
          step={1}
          value={subtitleStyle.fontSize}
          onChange={(e) => handleUpdate({ fontSize: Number(e.target.value) })}
          className="w-full h-1 bg-chrome-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary"
        />
      </div>

      {/* Position Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-xs font-semibold text-chrome-zinc-300">
          <span>Bottom Position</span>
          <span className="text-chrome-red-400 font-mono">{subtitleStyle.bottomPadding}px</span>
        </div>
        <input
          type="range"
          min={24}
          max={180}
          step={2}
          value={subtitleStyle.bottomPadding}
          onChange={(e) => handleUpdate({ bottomPadding: Number(e.target.value) })}
          className="w-full h-1 bg-chrome-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary"
        />
      </div>

      {/* Text Colors Grid */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-chrome-zinc-300">Text Color</div>
        <div className="flex flex-wrap gap-2.5">
          {textColors.map((color) => {
            const isSelected = subtitleStyle.textColor.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                onClick={() => handleUpdate({ textColor: color })}
                className="relative w-8 h-8 rounded-full border border-chrome-white/10 transition-transform active:scale-95 shadow-md hover:scale-105"
                style={{ backgroundColor: color }}
              >
                {isSelected && (
                  <span className="absolute inset-0 rounded-full border-2 border-primary scale-110 shadow-lg shadow-primary/30" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Background Colors Grid */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-chrome-zinc-300">Background Color</div>
        <div className="flex flex-wrap gap-2.5">
          {backgroundColors.map((color) => {
            const isSelected = subtitleStyle.backgroundColor.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                onClick={() => handleUpdate({ backgroundColor: color })}
                className="relative w-8 h-8 rounded-full border border-chrome-white/10 transition-transform active:scale-95 shadow-md hover:scale-105"
                style={{ backgroundColor: color }}
              >
                {isSelected && (
                  <span className="absolute inset-0 rounded-full border-2 border-primary scale-110 shadow-lg shadow-primary/30" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Background Opacity Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-xs font-semibold text-chrome-zinc-300">
          <span>Background Opacity</span>
          <span className="text-chrome-red-400 font-mono">
            {Math.round(subtitleStyle.backgroundOpacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={subtitleStyle.backgroundOpacity}
          onChange={(e) => handleUpdate({ backgroundOpacity: Number(e.target.value) })}
          className="w-full h-1 bg-chrome-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary"
        />
      </div>

      {/* Bold Text Switch Row */}
      <div className="flex justify-between items-center py-1">
        <span className="text-xs font-semibold text-chrome-zinc-300">Bold Text</span>
        <button
          type="button"
          onClick={() => handleUpdate({ isBold: !subtitleStyle.isBold })}
          className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            subtitleStyle.isBold ? "bg-primary" : "bg-chrome-zinc-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-chrome-white shadow ring-0 transition duration-200 ease-in-out ${
              subtitleStyle.isBold ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Reset Action */}
      <button
        type="button"
        onClick={handleReset}
        className="mt-2 flex h-9 items-center justify-center gap-2 rounded-md border border-chrome-white/10 bg-chrome-white/5 text-xs font-bold text-chrome-zinc-200 transition-colors hover:bg-chrome-white/10 hover:text-chrome-white"
      >
        <Undo2 size={14} />
        Reset to Default
      </button>
    </div>
  );
};

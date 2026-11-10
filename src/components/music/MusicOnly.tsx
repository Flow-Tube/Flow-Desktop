import { Navigate, Outlet } from "react-router-dom";
import { useMusicEnabled } from "../../lib/useMusicContent";

/** Music pages, which lead Home while Show Music is off: a saved link or an old tab can still point here. */
export function MusicOnly() {
  return useMusicEnabled() ? <Outlet /> : <Navigate to="/" replace />;
}

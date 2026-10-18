import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tablehouse Restaurant Workspace",
    short_name: "Tablehouse",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f2",
    theme_color: "#123e31",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

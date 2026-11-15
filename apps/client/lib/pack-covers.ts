const PACK_COVERS = {
  daily: "/pack-covers/01_daily_drop.webp",
  og: "/pack-covers/02_og_trickshot.webp",
  house: "/pack-covers/03_faze_house.webp",
  gaming: "/pack-covers/04_gaming_legends.webp",
  rebirth: "/pack-covers/05_rebirth.webp",
} as const;

export function packCoverForName(name: string) {
  const packName = name.toLowerCase();
  if (packName.includes("daily")) return PACK_COVERS.daily;
  if (packName.includes("rebirth")) return PACK_COVERS.rebirth;
  if (packName.includes("gaming") || packName.includes("esport")) return PACK_COVERS.gaming;
  if (packName.includes("house") || packName.includes("creator")) return PACK_COVERS.house;
  return PACK_COVERS.og;
}

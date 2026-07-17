/**
 * Kit colors for the overlay's team identity, keyed by the exact team name
 * strings TxLINE uses (mirrored in chain/fixtures.json). `accent` must stay
 * readable on the dark glass surfaces; `badge`/`badgeText` style the shirt-
 * number circles. Unknown teams fall back to the classic Onside cyan/pink.
 * Green (#34d399) is reserved for the ⚽ next-scorer pick — never a kit here.
 */
export interface TeamColors {
  accent: string;
  badge: string;
  badgeText: string;
}

const KITS: Record<string, TeamColors> = {
  England: { accent: "#e8f0fa", badge: "#1a2f5e", badgeText: "#ffffff" },
  Argentina: { accent: "#7fc0ee", badge: "#75aadb", badgeText: "#08131f" },
  Norway: { accent: "#ef5350", badge: "#c8102e", badgeText: "#ffffff" },
  France: { accent: "#6f8fe8", badge: "#21304e", badgeText: "#ffffff" },
  Spain: { accent: "#f0625d", badge: "#aa151b", badgeText: "#f1bf00" },
  Belgium: { accent: "#f2c94c", badge: "#2d2926", badgeText: "#fdda25" },
  Morocco: { accent: "#ef6a5a", badge: "#c1272d", badgeText: "#0f7043" },
  Switzerland: { accent: "#ef5350", badge: "#d52b1e", badgeText: "#ffffff" },
  Brazil: { accent: "#ffd952", badge: "#ffdf00", badgeText: "#00913f" },
  Germany: { accent: "#f5f5f5", badge: "#0b0b0b", badgeText: "#ffffff" },
  Netherlands: { accent: "#ff9d4d", badge: "#f36c21", badgeText: "#11131f" },
  Portugal: { accent: "#ef5b5b", badge: "#9e1b32", badgeText: "#f5d34c" },
  Croatia: { accent: "#f28b8b", badge: "#dd0000", badgeText: "#ffffff" },
  Mexico: { accent: "#4dbd8a", badge: "#006847", badgeText: "#ffffff" },
  USA: { accent: "#93b5e8", badge: "#1f3a68", badgeText: "#ffffff" },
  Uruguay: { accent: "#8fc4ee", badge: "#5a9bd5", badgeText: "#0c1524" },
  Colombia: { accent: "#ffd952", badge: "#fcd116", badgeText: "#1a2a5e" },
  Japan: { accent: "#7f9ff0", badge: "#1d2088", badgeText: "#ffffff" },
  Senegal: { accent: "#4dbd8a", badge: "#00853f", badgeText: "#fdef42" },
  Ghana: { accent: "#f2c94c", badge: "#0b0b0b", badgeText: "#fcd116" },
  Ecuador: { accent: "#ffd952", badge: "#ffdd00", badgeText: "#12264a" },
  Canada: { accent: "#ef5350", badge: "#d52b1e", badgeText: "#ffffff" },
  Australia: { accent: "#f2c94c", badge: "#f2b705", badgeText: "#0f3d2e" },
  Egypt: { accent: "#ef5350", badge: "#ce1126", badgeText: "#ffffff" },
  Austria: { accent: "#ef5350", badge: "#ed2939", badgeText: "#ffffff" },
  Paraguay: { accent: "#ef5350", badge: "#d52b1e", badgeText: "#ffffff" },
  Algeria: { accent: "#4dbd8a", badge: "#006233", badgeText: "#ffffff" },
  Jordan: { accent: "#ef5350", badge: "#ce1126", badgeText: "#ffffff" },
};

const FALLBACK: Record<"home" | "away", TeamColors> = {
  home: { accent: "#00DEF0", badge: "#00391F", badgeText: "#EDF4EF" },
  away: { accent: "#00DEF0", badge: "#00391F", badgeText: "#EDF4EF" },
};

export function teamColors(teamName: string | undefined, side: "home" | "away"): TeamColors {
  return (teamName && KITS[teamName]) || FALLBACK[side];
}

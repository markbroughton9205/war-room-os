import type { McInput, McView } from "./foundryMissionControlTypes";

export function describeTimeline(timeline: McInput["timeline"], limit: number): McView["timeline"] {
  return timeline
    .filter((entry) => entry.text.trim() !== "")
    .sort((a, b) => parseInt(a.at, 10) - parseInt(b.at, 10))
    .slice(-limit)
    .map((entry) => ({
      at: entry.at,
      text: entry.text.charAt(0).toUpperCase() + entry.text.slice(1),
    }));
}
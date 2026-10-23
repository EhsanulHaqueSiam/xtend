import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Gauge,
  Home,
  MessageSquareReply,
  PenLine,
  Radar,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface Screen {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Single-letter shortcut, pressed with no input focused. */
  readonly key?: string;
}

export const SCREENS: ReadonlyArray<Screen> = [
  { to: "/", label: "Home", icon: Home },
  { to: "/seen", label: "Seen", icon: Radar },
  { to: "/compose", label: "Compose", icon: PenLine, key: "c" },
  { to: "/plan", label: "Plan", icon: CalendarDays, key: "p" },
  { to: "/analyze", label: "Analyze", icon: BarChart3, key: "a" },
  { to: "/engage", label: "Engage", icon: MessageSquareReply, key: "e" },
  { to: "/library", label: "Library", icon: BookOpen, key: "l" },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/automate", label: "Automate", icon: Workflow },
  { to: "/scores", label: "Scores", icon: Gauge },
  { to: "/settings", label: "Settings", icon: Settings },
];

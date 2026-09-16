export type Day = 'saturday' | 'wednesday';
export type RsvpStatus = 'going' | 'skip';
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected';
export type TabId = 'sessions' | 'players' | 'fees' | 'admin' | 'history' | 'match' | 'tournament';

export interface MatchAssignment {
  court: number;
  team1: [string, string];
  team2: [string, string];
  score1?: number | null;
  score2?: number | null;
}

export interface MatchRound {
  roundNumber: number;
  assignments: MatchAssignment[];
  resting: string[];
  locked: boolean;
}

export interface MatchScheduleState {
  rounds: MatchRound[];
  totalRoundsSetting: number;
  gamesPlayed: Record<string, number>;
  restCount: Record<string, number>;
  partnerHistory: Record<string, number>;
  opponentHistory: Record<string, number>;
  playerSnapshot: string[];
  courtSnapshot: number[];
}

export interface PlayerColor {
  bg: string;
  fg: string;
}

export interface Player {
  name: string;
  skill: string | null;
  balance: number;
  color: PlayerColor;
  initials: string;
  email?: string | null;
  pin?: string | null;
  id?: string;
  role?: string;
  emoji?: string | null;
  archived?: boolean;
  shirt_size?: string | null;
  avatar_url?: string | null;
}

export interface RsvpData {
  saturday: Record<string, RsvpStatus>;
  wednesday: Record<string, RsvpStatus>;
}

export type GuestLevel = 'E' | 'I' | 'B';

export interface GuestEntry {
  name: string;
  brought_by?: string;
  level?: GuestLevel;
}

export interface GuestData {
  saturday: GuestEntry[];
  wednesday: GuestEntry[];
}

export interface CourtData {
  saturday: number[];
  wednesday: number[];
}

export interface Payment {
  id: number;
  player_name: string;
  amount: number;
  status: PaymentStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface FundEntry {
  id: number;
  amount: number;
  entered_by: string;
  notes: string;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  week: string;
  day: Day;
  player_name: string;
  created_at: string;
}

export interface SessionDeduction {
  id: number;
  week: string;
  day: Day;
  courts_count: number;
  rate_per_court: number;
  total_cost: number;
  players_count: number;
  per_person: number;
  deducted_by: string;
  created_at: string;
}

export interface PlayerTransfer {
  id: number;
  player_name: string;
  amount: number;
  recipient: string;
  method: string;
  status: 'pending' | 'confirmed' | 'rejected';
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string;
  created_at: string;
}

export interface CompletedSession {
  id: number;
  week: string;
  day: Day;
  session_date: string;
  players: string[];
  guests: GuestEntry[];
  courts: number[];
  courts_count: number;
  rate_per_court: number;
  total_cost: number;
  players_count: number;
  per_person: number;
  session_hours?: number;
  player_hours?: Record<string, number>;
  auto_deducted: boolean;
  is_extra?: boolean;
  created_at: string;
}

export interface AppSettings {
  admin1: string;
  admin2: string;
  court_rate: string;
  courts_saturday: string;
  courts_wednesday: string;
  cancelled_saturday: string;
  cancelled_wednesday: string;
  wed_time: string;
  [key: string]: string;
}

export interface CourtPayment {
  id: number;
  payment_date: string;
  amount: number;
  hours_purchased: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface MiscExpense {
  id: number;
  expense_date: string;
  description: string;
  amount: number;
  quantity: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface FinanceHistoryEntry {
  id: number;
  history_type: 'funds' | 'hours';
  change_type: string;
  previous_value: number;
  new_value: number;
  reason: string;
  created_at: string;
}

export interface HoursOverride {
  value: number;
  system_value: number;
  date: string;
  reason: string;
}
export interface ExtraSession {
  id: number;
  title: string;
  session_date: string;
  start_time: string;
  end_time: string;
  courts: number[];
  cutoff_time: string | null;
  cancelled: boolean;
  created_by: string;
  created_at: string;
  auto_deducted?: boolean;
  per_person?: number;
  total_cost?: number;
  players_count?: number;
  locked?: boolean;
}

export interface ExtraSessionRsvp {
  id: number;
  session_id: number;
  player_name: string;
  status: 'going' | 'skip';
  created_at: string;
}

export interface ExtraSessionGuest {
  id: string;
  session_id: number;
  brought_by: string;
  friends: string; // JSON array of {name, level}
  created_at: string;
}

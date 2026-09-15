export interface SongItem {
  id: string;
  userName: string;
  requester?: string;
  videoId: string;
  title: string;
  channelTitle?: string;
  thumbnail: string;
  duration?: string;
  addedAt: number;
  priority?: boolean;
  wasOnlineAtStart?: boolean;
}

export interface SearchResultItem {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  duration?: string;
  views?: string | number;
}

export interface SongInteractions {
  totalPoints: number;
  hearts: number;
  flowers: number;
  cheers: number;
  claps: number;
  crowns?: number;
  rockets?: number;
  comments: number;
}

export interface ReactionItem {
  id: string;
  type: 'heart' | 'flower' | 'cheers' | 'clap' | 'crown' | 'rocket' | 'comment';
  userName: string;
  text?: string;
  points: number;
  timestamp: number;
  interactions?: SongInteractions;
}

export interface SyncStateData {
  currentSong: SongItem | null;
  queue: SongItem[];
  totalWaiting: number;
  interactions?: SongInteractions;
  coSingers?: string[];
  isSingerOnline?: boolean;
}

export interface RoomMember {
  id: string;
  userId?: string;
  name: string;
  score: number;
  points?: number;
  joinedAt?: number;
  isOnline?: boolean;
}

export interface ScoreSettledResult {
  singer: string;
  leadSinger: string;
  isLeadOnline: boolean;
  wasOnlineAtStart: boolean;
  coSingers: string[];
  songTitle: string;
  baseScore: number;
  interactionBonus: number;
  totalSongScore: number;
  earnedScore: number;
  leadSingerScore: number;
  coSingerScore: number;
  comment?: string;
  breakdownText?: string;
  scoreAddedHint?: string;
}

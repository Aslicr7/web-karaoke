import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
// @ts-ignore
import ytSearch from 'yt-search';

const rootDir = process.cwd();

// Tự động dò địa chỉ IPv4 mạng LAN nội bộ của máy chủ
function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const net of netList) {
      const family = String(net.family);
      if (family === 'IPv4' && !net.internal) {
        // Ưu tiên dải Wi-Fi / Hotspot / LAN nội bộ (10.x.x.x, 192.168.x.x, 172.16.x.x - 172.31.x.x)
        if (
          net.address.startsWith('10.') ||
          net.address.startsWith('192.168.') ||
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(net.address)
        ) {
          return net.address;
        }
        candidates.push(net.address);
      }
    }
  }

  // Bỏ qua dải link-local 169.254.x.x nếu có IP ứng viên khác
  const validCandidates = candidates.filter(ip => !ip.startsWith('169.254.'));
  if (validCandidates.length > 0) {
    return validCandidates[0];
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  return 'localhost';
}

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
  wasPresentDuringSong?: boolean;
}

export interface RoomMember {
  id: string;
  userId?: string;
  name: string;
  score: number;
  joinedAt: number;
  isOnline?: boolean;
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

export interface RoomData {
  id: string;
  pin: string;
  createdAt: number;
  lastActive: number;
  currentSong: SongItem | null;
  currentSongPresence?: boolean;
  queue: SongItem[];
  members: RoomMember[];
  interactions: SongInteractions;
  userContributions: Record<string, number>;
  coSingers: string[];
  activeParticipantsInSong: Set<string>;
  currentSongScoreSettled: boolean;
  lastSettledScoreResult: any;
  hostSocketId?: string;
  hostSocketIds: Set<string>;
  hostToken?: string;
  lastSongEndedAt?: number;
}

const app = express();
const httpServer = http.createServer(app);
const server = httpServer;
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Thiết lập cổng máy chủ: mặc định 8068, ưu tiên process.env.PORT nếu môi trường có chỉ định
const PORT = Number(process.env.PORT) || 8068;

// 1. QUẢN LÝ ĐA PHÒNG ĐỘC LẬP TRÊN SERVER
const rooms = new Map<string, RoomData>();

// Timers cho host disconnect grace period (15s chờ TV F5 hoặc khôi phục mạng)
const hostDisconnectTimers = new Map<string, NodeJS.Timeout>();

// Helper tạo interactions mặc định
function createDefaultInteractions(): SongInteractions {
  return {
    totalPoints: 0,
    hearts: 0,
    flowers: 0,
    cheers: 0,
    claps: 0,
    crowns: 0,
    rockets: 0,
    comments: 0
  };
}

// Helper lấy hoặc khởi tạo phòng karaoke
function getOrCreateRoom(roomId: string, createPinIfNew = true): RoomData {
  const cleanId = (roomId || 'default').trim();
  let room = rooms.get(cleanId);
  if (!room) {
    const pin = createPinIfNew ? Math.floor(1000 + Math.random() * 9000).toString() : '0000';
    room = {
      id: cleanId,
      pin,
      createdAt: Date.now(),
      lastActive: Date.now(),
      currentSong: null,
      queue: [],
      members: [],
      interactions: createDefaultInteractions(),
      userContributions: {},
      coSingers: [],
      activeParticipantsInSong: new Set<string>(),
      currentSongScoreSettled: false,
      lastSettledScoreResult: null,
      hostSocketIds: new Set<string>()
    };
    rooms.set(cleanId, room);
  }
  if (!room.hostSocketIds) {
    room.hostSocketIds = new Set<string>();
  }
  if (!room.activeParticipantsInSong) {
    room.activeParticipantsInSong = new Set<string>();
  }
  room.lastActive = Date.now();
  return room;
}

// Helper: Phân tích cookies từ HTTP Request
function parseCookies(req: express.Request): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        list[parts.shift()!.trim()] = decodeURIComponent(parts.join('='));
      }
    });
  }
  return list;
}

// Helper: Extract YouTube video ID from various link formats or raw ID
export function extractYouTubeId(urlOrId: string): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  // If already 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  // Regex for youtu.be, youtube.com/watch?v=, /embed/, /shorts/, etc.
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

// Helper: Fetch video metadata via public YouTube oEmbed (no API key required)
async function fetchYouTubeMeta(videoId: string): Promise<{ title: string; thumbnail: string }> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json() as { title?: string; thumbnail_url?: string };
      return {
        title: data.title || `Video #${videoId}`,
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
      };
    }
  } catch (err) {
    console.error('Error fetching YouTube oEmbed:', err);
  }
  return {
    title: `Karaoke Video #${videoId}`,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
  };
}

// Helper: Sắp xếp bảng xếp hạng thành viên giảm dần theo số điểm trong phòng
function getSortedMembers(room: RoomData): RoomMember[] {
  // Cập nhật trạng thái online thực tế cho tất cả thành viên trong phòng
  for (const m of room.members) {
    if (!m.id) {
      m.isOnline = false;
    } else {
      const sock = io.sockets.sockets.get(m.id);
      m.isOnline = Boolean(sock && sock.connected);
    }
  }

  room.members.sort((a, b) => {
    const scoreB = (b.score ?? (b as any).points ?? 0);
    const scoreA = (a.score ?? (a as any).points ?? 0);
    return scoreB - scoreA;
  });
  return room.members;
}

// Helper: Lấy tên ca sĩ chính của bài hát đang phát trong phòng
function getLeadSingerName(room: RoomData): string {
  if (!room.currentSong) return '';
  return (room.currentSong.userName || room.currentSong.requester || '').trim();
}

// Helper: Quản lý người tham gia theo phiên bài hát (dạng Set trong RAM của Server)
function initSongSessionParticipants(room: RoomData) {
  if (!room.activeParticipantsInSong) {
    room.activeParticipantsInSong = new Set<string>();
  }
  room.activeParticipantsInSong.clear();
  // Thêm tất cả thành viên đang online vào activeParticipantsInSong (lưu theo nickname)
  for (const m of room.members) {
    if (m && m.isOnline && m.name) {
      room.activeParticipantsInSong.add(m.name.trim().toLowerCase());
    }
  }
  console.log(`🎙️ [${room.id}] Initialized song session participants:`, Array.from(room.activeParticipantsInSong));
}

function recordParticipantInCurrentSong(room: RoomData, nickname?: string) {
  if (!nickname || !room) return;
  const clean = nickname.trim().toLowerCase();
  if (!clean) return;
  if (!room.activeParticipantsInSong) {
    room.activeParticipantsInSong = new Set<string>();
  }
  room.activeParticipantsInSong.add(clean);
}

function isParticipantInCurrentSong(room: RoomData, nickname?: string): boolean {
  if (!nickname || !room || !room.activeParticipantsInSong) return false;
  return room.activeParticipantsInSong.has(nickname.trim().toLowerCase());
}

// Broadcast queue and now playing song to all connected sockets in a specific room
function broadcastState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  getSortedMembers(room);
  const lead = getLeadSingerName(room);
  const isSingerOnline = lead ? isParticipantInCurrentSong(room, lead) : false;

  io.to(roomId).emit('sync_state', {
    currentSong: room.currentSong,
    queue: room.queue,
    totalWaiting: room.queue.length,
    interactions: room.interactions,
    coSingers: room.coSingers,
    isSingerOnline
  });
  io.to(roomId).emit('queue_updated', room.queue);
}

// Next song handler for a specific room
function playNextSong(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Reset bộ đếm tương tác, danh sách hát cùng và kết quả chấm điểm khi chuyển bài mới cho ca sĩ tiếp theo
  room.currentSongScoreSettled = false;
  room.lastSettledScoreResult = null;
  room.userContributions = {};
  room.coSingers = [];
  room.interactions = createDefaultInteractions();

  if (room.queue.length > 0) {
    room.currentSong = room.queue.shift()!;
    // Khởi tạo tập hợp người tham gia cho phiên bài hát mới từ những người đang online
    initSongSessionParticipants(room);

    console.log(`🎵 [${roomId}] Next song: "${room.currentSong.title}" for singer "${room.currentSong.userName}"`);
    io.to(roomId).emit('play_song', room.currentSong);
  } else {
    room.currentSong = null;
    room.currentSongPresence = false;
    if (room.activeParticipantsInSong) {
      room.activeParticipantsInSong.clear();
    }
    console.log(`⏹️ [${roomId}] Queue empty, stopping playback`);
    io.to(roomId).emit('stop_song');
  }
  broadcastState(roomId);
}

// BẢNG CÂU NHẬN XÉT CHẤM ĐIỂM KARAOKE THEO THANG ĐIỂM THỰC TẾ
const SCORE_COMMENTS_0 = [
  'Vắng mặt suốt bài hát, phòng xin thu hồi micro!',
  'Người đi để lại nỗi đau, hệ thống xin tặng 0 điểm.',
  'Bận đi giao lưu bàn bên rồi đúng không? 0 điểm nhé!',
  'Đi đâu mất hút lúc bài lên, phạt nhẹ 0 tròn trĩnh!',
  'Hát bằng tâm linh hay sao mà không nghe thấy tiếng?',
  'Bỏ mic chạy lấy người, không thể cứu vớt số điểm này.',
  'Bài hát cô đơn nhất đêm nay vì chẳng thấy ca sĩ đâu.',
  'Hát thầm trong suy nghĩ thì máy chấm điểm chịu thua rồi.',
  'Mất tích đúng lúc cao trào, nhận ngay con số không tròn trĩnh.',
  'Ghế trống mic nằm im, hẹn bạn bài sau quay lại!'
];

const SCORE_COMMENTS_65_74 = [
  'Hát vì đam mê là chính, điểm số chỉ là phù du!',
  'Tông một đường giọng một nẻo, nhưng được cái nhiệt tình!',
  'Giọng hát mộc mạc, đúng chất văn nghệ quần chúng.',
  'Hơi đuối ở điệp khúc một chút, làm hớp bia lấy lại sức nhé!',
  'Nhịp hơi chao đảo một tí nhưng tinh thần rất đáng khen.',
  'Cần lấy thêm một chút hơi ở những đoạn nốt cao.',
  'Cảm ơn bạn đã dũng cảm cầm mic mở bát cho phòng!',
  'Giữ vững phong độ này và rèn thêm chút luyến láy nhé.',
  'Một tiết mục vừa vặn để hâm nóng không khí cả phòng.',
  'Hát chuẩn lời rồi, thêm chút cảm xúc nữa là kéo điểm lên ngay!'
];

const SCORE_COMMENTS_75_84 = [
  'Hát rất có nét, nghe êm tai và bắt nhịp chuẩn phết!',
  'Xử lý nốt cao khá mượt mà, phòng vỗ tay rào rào rồi!',
  'Giọng có nội lực, nghe rất đã tai và cuốn hút.',
  'Cảm xúc dạt dào, nghe như đang kể chuyện tình của chính mình.',
  'Trình diễn rất tự tin, phong thái không thua gì ca sĩ bán chuyên.',
  'Bắt đúng nhịp điệu, giữ hơi tốt từ đầu đến cuối bài.',
  'Giọng hát đầy triển vọng, sắp thành idol của phòng rồi!',
  'Điểm số xứng đáng cho một màn thể hiện đầy tâm huyết!',
  'Tone giọng rất đẹp và sáng, phát huy tiếp ở bài sau nhé!',
  'Tiết mục rất chất lượng, nghe là muốn nghe thêm bài nữa!'
];

const SCORE_COMMENTS_85_94 = [
  'Hát quá cảm xúc, làm cả phòng ai nấy đều lặng người lắng nghe!',
  'Giọng hát ngọt ngào truyền cảm, nghe nổi hết cả da gà!',
  'Xử lý nốt cao và luyến láy quá đỉnh, như ca sĩ chuyên nghiệp vậy!',
  'Màn trình diễn đỉnh cao, xứng danh giọng ca vàng của đêm nay!',
  'Cảm xúc chạm đáy tim, nghe mà rơm rớm nước mắt luôn rồi.',
  'Giọng ca phòng trà thứ thiệt, vừa trầm ấm vừa nội lực.',
  'Hát thế này thì quán karaoke phải trả thêm cát-xê cho bạn mới đúng!',
  'Từng câu từng chữ đều thấm đẫm cảm xúc, quá tuyệt vời!',
  'Cả phòng ngả mũ thán phục trước giọng hát của bạn!',
  'Idol xuất hiện rồi, hát không chê vào đâu được!'
];

const SCORE_COMMENTS_95_100 = [
  'Xuất sắc không tì vết, bạn sinh ra là để làm ca sĩ chuyên nghiệp!',
  'Đỉnh nóc kịch trần, một tuyệt phẩm âm nhạc đêm nay!',
  'Divo/Diva của phòng là đây chứ tìm đâu xa nữa!',
  'Điểm tuyệt đối cho một giọng ca hoàn hảo từ kỹ thuật tới cảm xúc!',
  'Hát hay đến mức YouTube cũng muốn cấp bản quyền riêng cho bạn!',
  'Cả phòng chỉ biết nín thở vỗ tay cho màn trình diễn đẳng cấp này!',
  'Giọng hát làm lu mờ luôn cả bản gốc của ca sĩ!',
  'Quán quân tuyệt đối, đứng trên đỉnh bảng xếp hạng rồi!',
  'Đẳng cấp nghệ sĩ thực thụ, xin hãy nhận tràng pháo tay của cả phòng!',
  'Giọng ca vàng bạc tỷ, 100 điểm cũng chưa đủ để diễn tả độ hay!'
];

function getKaraokeScoreComment(score: number, isAbsent: boolean = false): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  if (isAbsent || score <= 0) {
    return pick(SCORE_COMMENTS_0);
  }
  if (score < 75) {
    return pick(SCORE_COMMENTS_65_74);
  }
  if (score < 85) {
    return pick(SCORE_COMMENTS_75_84);
  }
  if (score < 95) {
    return pick(SCORE_COMMENTS_85_94);
  }
  return pick(SCORE_COMMENTS_95_100);
}

// 4. CƠ CHẾ CHỐT SỔ VÀ TỔNG KẾT ĐIỂM CUỐI BÀI (HOẶC KHI QUA BÀI SỚM) THEO PHÒNG
function settleCurrentSongScore(room: RoomData) {
  if (room.currentSongScoreSettled && room.lastSettledScoreResult) {
    return room.lastSettledScoreResult;
  }

  let totalValidBonus = 0;
  for (const [rawName, contributed] of Object.entries(room.userContributions)) {
    const trimmed = rawName.trim().toLowerCase();
    const member = room.members.find((m) => m.name.trim().toLowerCase() === trimmed);
    if (member) {
      const available = typeof member.score === 'number' ? member.score : 50;
      const valid = Math.min(contributed, Math.max(0, available));
      member.score = Math.max(0, available - valid);
      totalValidBonus += valid;
      console.log(`🎁 [${room.id}] User "${member.name}": contributed ${contributed} pts, had ${available} pts -> valid deduction ${valid} pts, remaining ${member.score} pts`);
    }
  }

  const singer = room.currentSong ? (room.currentSong.userName || 'Khách') : 'Khách';
  const songTitle = room.currentSong ? room.currentSong.title : 'Bài hát vừa rồi';

  // 1. Điểm hát gốc (Base Score) ngẫu nhiên dao động từ 65 đến 80 điểm
  const baseScore = Math.floor(Math.random() * 16) + 65; // [65 .. 80]
  // 2. Điểm tổng kết bài hát = Điểm gốc + Điểm quà tặng/bình luận, tuyệt đối không vượt quá trần 100 điểm
  let totalSongScore = Math.min(100, Math.round(baseScore + totalValidBonus));

  const singerTrimmed = singer.trim().toLowerCase();
  const singerMember = room.members.find((m) => m.name.trim().toLowerCase() === singerTrimmed);
  const isLeadOnlineNow = singerMember ? Boolean(singerMember.isOnline) : false;
  // Kiểm tra ca sĩ chính có nằm trong activeParticipantsInSong của phiên bài hát hay không
  const leadSingerWasActive = isParticipantInCurrentSong(room, singer);
  const hasCoSingers = room.coSingers && room.coSingers.length > 0;

  let leadSingerScore = 0;
  let coSingerScore = 0;
  let earnedScore = 0;

  if (leadSingerWasActive) {
    // TRƯỜNG HỢP 1: Ca sĩ có mặt trong phiên bài hát (có trong activeParticipantsInSong)
    // Chấm điểm ngẫu nhiên (hoặc theo tương tác) và cộng dồn vào BXH như bình thường
    leadSingerScore = totalSongScore;
    earnedScore = totalSongScore;
    if (singerMember) {
      singerMember.score = (singerMember.score || 0) + leadSingerScore;
      console.log(`🎤 [${room.id}] Lead singer "${singerMember.name}" (Active in song) awarded ${leadSingerScore} pts. Total score: ${singerMember.score}`);
    }

    // Nếu có người hát phụ: Người hát phụ nhận thêm +50% điểm như quy định
    if (hasCoSingers) {
      coSingerScore = Math.round(totalSongScore * 0.5);
      for (const cs of room.coSingers) {
        const csTrimmed = cs.trim().toLowerCase();
        if (csTrimmed === singerTrimmed) continue;

        const csMember = room.members.find((m) => m.name.trim().toLowerCase() === csTrimmed);
        if (csMember) {
          csMember.score = (csMember.score || 0) + coSingerScore;
          console.log(`🎤 [${room.id}] Co-singer (Phụ) "${csMember.name}" awarded ${coSingerScore} pts (50%). Total score: ${csMember.score}`);
        }
      }
    }
  } else {
    // TRƯỜNG HỢP 2: VẮNG MẶT TOÀN BỘ THỜI GIAN BÀI HÁT:
    // Chấm 0 điểm cho ca sĩ chính, TUYỆT ĐỐI KHÔNG cộng điểm BXH
    leadSingerScore = 0;
    console.log(`⚠️ [${room.id}] Lead singer "${singer}" was absent throughout entire song session -> 0 pts, no score added to leaderboard.`);

    if (hasCoSingers) {
      // Nếu có người bấm "Hát cùng": Người hát phụ nhận +50% điểm (từ điểm bài hát + tương tác)
      coSingerScore = Math.round(totalSongScore * 0.5);
      earnedScore = coSingerScore;
      for (const cs of room.coSingers) {
        const csTrimmed = cs.trim().toLowerCase();
        if (csTrimmed === singerTrimmed) continue;

        const csMember = room.members.find((m) => m.name.trim().toLowerCase() === csTrimmed);
        if (csMember) {
          csMember.score = (csMember.score || 0) + coSingerScore;
          console.log(`🎤 [${room.id}] Co-singer (Phụ) "${csMember.name}" awarded 50% score (${coSingerScore} pts) while lead singer absent. Total: ${csMember.score}`);
        }
      }
    } else {
      // Ca sĩ chính vắng mặt suốt bài và không có ai hát cùng -> 0 điểm
      totalSongScore = 0;
      coSingerScore = 0;
      earnedScore = 0;
    }
  }

  // 3. Random câu nhận xét theo thang điểm thực tế
  // Nếu ca sĩ chính vắng mặt: chấm 0 điểm và chọn câu nhận xét 0 điểm đã cấu hình
  const comment = getKaraokeScoreComment(leadSingerWasActive ? totalSongScore : 0, !leadSingerWasActive);

  let breakdownText = '';
  let singerDisplay = singer;
  let scoreAddedHint = '';

  const leadLabel = isLeadOnlineNow ? singer : `${singer} (off)`;

  if (leadSingerWasActive) {
    // TRƯỜNG HỢP 1: Ca sĩ có mặt trong phiên bài hát
    breakdownText = totalValidBonus > 0
      ? `Bài hát: ${totalSongScore} đ (${baseScore}đ gốc + ${totalValidBonus}đ tương tác)`
      : `Bài hát: ${totalSongScore} đ (${baseScore}đ gốc + 0đ tương tác)`;

    let bonusDetail = '';
    if (baseScore + totalValidBonus >= 100) {
      bonusDetail = ` (${baseScore} gốc + ${totalValidBonus} quà - max 100)`;
    } else if (totalValidBonus > 0) {
      bonusDetail = ` (${baseScore} gốc + ${totalValidBonus} quà)`;
    }

    if (hasCoSingers) {
      singerDisplay = `${leadLabel} & ${room.coSingers.join(', ')} (Hát phụ)`;
      scoreAddedHint = `Ca sĩ chính: ${leadLabel} +${leadSingerScore}đ${bonusDetail} | Hát phụ: ${room.coSingers.join(', ')} +${coSingerScore}đ (50%)`;
    } else {
      singerDisplay = leadLabel;
      scoreAddedHint = `Ca sĩ chính: ${leadLabel} +${leadSingerScore}đ${bonusDetail}`;
    }
  } else {
    // TRƯỜNG HỢP 2: Ca sĩ vắng mặt suốt cả bài hát
    if (hasCoSingers) {
      singerDisplay = `${leadLabel} & ${room.coSingers.join(', ')} (Hát phụ)`;
      breakdownText = `Bài hát có người hát cùng: ${totalSongScore} đ (${baseScore}đ gốc + ${totalValidBonus}đ tương tác)`;
      scoreAddedHint = `Ca sĩ chính: ${leadLabel} 0đ (Vắng mặt cả bài) | Hát phụ: ${room.coSingers.join(', ')} +${coSingerScore}đ (50%)`;
    } else {
      singerDisplay = leadLabel;
      breakdownText = `Ca sĩ chính vắng mặt suốt cả bài hát (0đ)`;
      scoreAddedHint = `Ca sĩ chính: ${leadLabel} 0đ (Vắng mặt cả bài - không cộng điểm BXH)`;
    }
  }

  const result = {
    score: leadSingerWasActive ? totalSongScore : (hasCoSingers ? totalSongScore : 0),
    singer: singerDisplay,
    leadSinger: singer,
    isLeadOnline: isLeadOnlineNow,
    wasOnlineAtStart: leadSingerWasActive,
    wasPresentDuringSong: leadSingerWasActive,
    coSingers: [...room.coSingers],
    songTitle,
    baseScore: leadSingerWasActive ? baseScore : 0,
    interactionBonus: totalValidBonus,
    totalSongScore: leadSingerWasActive ? totalSongScore : (hasCoSingers ? totalSongScore : 0),
    earnedScore,
    leadSingerScore,
    coSingerScore,
    comment,
    breakdownText,
    scoreAddedHint
  };

  room.currentSongScoreSettled = true;
  room.lastSettledScoreResult = result;

  // Đồng bộ lại điểm số cá nhân và Bảng xếp hạng thành viên mới nhất (sắp xếp giảm dần theo điểm)
  const sortedMembers = getSortedMembers(room);
  io.to(room.id).emit('update_members', sortedMembers);
  broadcastState(room.id);

  return result;
}

app.use(express.json());

// API endpoints
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), roomsCount: rooms.size });
});

app.get('/api/active-room', (_req, res) => {
  if (rooms.size > 0) {
    for (const [id, r] of rooms.entries()) {
      if (r.hostSocketId) {
        return res.json({ activeRoomId: id, pin: r.pin });
      }
    }
    const [first] = rooms.values();
    return res.json({ activeRoomId: first.id, pin: first.pin });
  }
  res.json({ activeRoomId: null, pin: null });
});

// Cache for YouTube search to make UI lightning fast
const searchCache = new Map<string, { timestamp: number; data: any[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// 1. TÌM KIẾM BÀI HÁT YOUTUBE TRỰC TIẾP (/api/search?q=...)
app.get('/api/search', async (req, res) => {
  try {
    const rawQ = (req.query.q as string || '').trim();
    if (!rawQ) {
      return res.json({ results: [] });
    }

    // Nếu người dùng dán trực tiếp link hoặc Video ID 11 ký tự
    const directId = extractYouTubeId(rawQ);
    if (directId) {
      const meta = await fetchYouTubeMeta(directId);
      return res.json({
        results: [
          {
            videoId: directId,
            title: meta.title,
            channelTitle: 'YouTube Video',
            thumbnail: meta.thumbnail,
            duration: ''
          }
        ]
      });
    }

    // Tự động gắn thêm từ khóa "karaoke" vào sau nếu người dùng chưa gõ từ karaoke
    const normalizedQ = rawQ.toLowerCase();
    const searchTerm = normalizedQ.includes('karaoke') ? rawQ : `${rawQ} karaoke`;
    const cacheKey = searchTerm.toLowerCase();

    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return res.json({ results: cached.data });
    }

    console.log(`🔍 Searching YouTube for: "${searchTerm}"`);
    const searchRes = await ytSearch(searchTerm);
    const videos = (searchRes && searchRes.videos ? searchRes.videos : []).slice(0, 25);

    const results = videos.map((v: any) => ({
      videoId: v.videoId,
      title: v.title,
      channelTitle: (v.author && v.author.name) || '',
      thumbnail: v.thumbnail || v.image || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`,
      duration: v.timestamp || (v.duration && v.duration.timestamp) || '',
      views: v.views
    }));

    searchCache.set(cacheKey, { timestamp: Date.now(), data: results });
    res.json({ results });
  } catch (err) {
    console.error('API /api/search error:', err);
    res.status(500).json({ error: 'Lỗi khi tìm kiếm video YouTube', results: [] });
  }
});

app.get('/api/queue', (req, res) => {
  const roomId = ((req.query.room as string) || 'default').trim();
  const room = rooms.get(roomId);
  res.json({
    roomId,
    currentSong: room ? room.currentSong : null,
    queue: room ? room.queue : [],
    totalWaiting: room ? room.queue.length : 0
  });
});

app.get('/api/members', (req, res) => {
  const roomId = ((req.query.room as string) || 'default').trim();
  const room = rooms.get(roomId);
  res.json({
    roomId,
    members: room ? getSortedMembers(room) : [],
    total: room ? room.members.length : 0
  });
});

app.post('/api/queue', async (req, res) => {
  try {
    const { roomId: reqRoomId, userName, videoId, priority, title, channelTitle, thumbnail, duration } = req.body;
    const roomId = (reqRoomId || 'default').trim();
    const room = getOrCreateRoom(roomId);

    const cleanId = extractYouTubeId(videoId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Video ID hoặc Link YouTube không hợp lệ' });
    }

    let songTitle = title;
    let songThumb = thumbnail;
    if (!songTitle || !songThumb) {
      const meta = await fetchYouTubeMeta(cleanId);
      songTitle = songTitle || meta.title;
      songThumb = songThumb || meta.thumbnail;
    }

    const isPriority = Boolean(priority);
    const resolvedUser = (userName && userName.trim()) || 'Khách';
    const newSong: SongItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userName: resolvedUser,
      requester: resolvedUser,
      videoId: cleanId,
      title: songTitle || `Karaoke Video #${cleanId}`,
      channelTitle: channelTitle || '',
      thumbnail: songThumb || `https://img.youtube.com/vi/${cleanId}/mqdefault.jpg`,
      duration: duration || '',
      addedAt: Date.now(),
      priority: isPriority
    };

    if (!room.currentSong) {
      room.currentSong = newSong;
      room.coSingers = [];
      room.interactions = createDefaultInteractions();
      initSongSessionParticipants(room);
      if (newSong.userName) {
        recordParticipantInCurrentSong(room, newSong.userName);
      }
      io.to(roomId).emit('play_song', room.currentSong);
      io.to(roomId).emit('remote_unmute');
    } else if (isPriority) {
      room.queue.unshift(newSong);
    } else {
      room.queue.push(newSong);
    }

    broadcastState(roomId);
    res.json({ success: true, song: newSong, currentSong: room.currentSong, queueLength: room.queue.length, priority: isPriority });
  } catch (err) {
    console.error('API /api/queue error:', err);
    res.status(500).json({ error: 'Lỗi server khi thêm bài hát' });
  }
});

// Skip bài đang phát qua HTTP API
app.post('/api/queue/skip', (req, res) => {
  const roomId = (req.body.roomId || (req.query.room as string) || 'default').trim();
  const room = rooms.get(roomId);
  if (!room) {
    return res.json({ success: false, message: 'Phòng không tồn tại' });
  }
  if (room.currentSong) {
    io.to(roomId).emit('request_skip');
  } else {
    playNextSong(roomId);
  }
  res.json({ success: true, currentSong: room.currentSong, queueLength: room.queue.length });
});

// Xóa toàn bộ hàng đợi
app.delete('/api/queue', (req, res) => {
  const roomId = ((req.query.room as string) || 'default').trim();
  const room = rooms.get(roomId);
  if (room) {
    room.queue = [];
    broadcastState(roomId);
  }
  res.json({ success: true, message: 'Đã xóa toàn bộ hàng đợi' });
});

// Socket.io real-time connection
io.on('connection', (socket) => {
  console.log('⚡ Client connected:', socket.id);

  // Helper lấy roomId cho socket
  const getSocketRoomId = (fallbackId?: string): string => {
    return (socket.data.roomId || fallbackId || '').trim();
  };

  // 1. ĐĂNG KÝ TV HOST: HỖ TRỢ MULTI-SCREEN (TV PHỤ) VỚI MÃ PIN 4 SỐ CỦA PHÒNG
  const handleHostRegister = (
    clientSocket: any,
    data: { roomId?: string; hostToken?: string; pin?: string },
    callback?: (res: any) => void
  ) => {
    const roomId = (data && data.roomId ? data.roomId.trim() : '') || 'default';
    const hostToken = data && data.hostToken ? data.hostToken.trim() : '';
    const pin = data && data.pin ? String(data.pin).trim() : '';

    let room = rooms.get(roomId);
    if (!room) {
      room = getOrCreateRoom(roomId);
    }
    if (!room.hostSocketIds) {
      room.hostSocketIds = new Set<string>();
    }

    // Dọn dẹp socket host đã ngắt kết nối
    for (const sid of Array.from(room.hostSocketIds)) {
      const s = io.sockets.sockets.get(sid);
      if (!s || !s.connected) {
        room.hostSocketIds.delete(sid);
      }
    }
    if (room.hostSocketId && !room.hostSocketIds.has(room.hostSocketId) && !hostDisconnectTimers.has(roomId)) {
      room.hostSocketId = undefined;
    }

    const hasActivePrimary = !!(room.hostSocketId && io.sockets.sockets.get(room.hostSocketId)?.connected);
    const hasGracePeriod = hostDisconnectTimers.has(roomId);
    const isSameHostReconnecting = !!(hostToken && room.hostToken === hostToken);
    const isAlreadyRegistered = room.hostSocketIds.has(clientSocket.id);

    // TRƯỜNG HỢP 1: TV Host chính (Primary Host) F5 hoặc kết nối lại (cùng hostToken)
    if (isSameHostReconnecting) {
      console.log(`📺 [${roomId}] Primary TV Host reconnected (matching hostToken). Re-binding host socket ${clientSocket.id}.`);
      if (hasGracePeriod) {
        clearTimeout(hostDisconnectTimers.get(roomId)!);
        hostDisconnectTimers.delete(roomId);
      }
      room.hostSocketId = clientSocket.id;
      room.hostSocketIds.add(clientSocket.id);
      clientSocket.join(roomId);
      clientSocket.data.roomId = roomId;
      clientSocket.data.isHost = true;
      clientSocket.data.isPrimaryHost = true;

      const successRes = { success: true, roomId, pin: room.pin, isReconnected: true, isPrimary: true };
      if (typeof callback === 'function') callback(successRes);
      clientSocket.emit('host_ready', successRes);
      if (room.currentSong) {
        clientSocket.emit('play_song', room.currentSong);
      }
      broadcastState(roomId);
      io.to(roomId).emit('update_members', getSortedMembers(room));
      return;
    }

    // TRƯỜNG HỢP 2: Socket này đã đăng ký trong phòng
    if (isAlreadyRegistered) {
      const isPrimary = room.hostSocketId === clientSocket.id;
      const successRes = { success: true, roomId, pin: room.pin, isPrimary, isSecondary: !isPrimary };
      if (typeof callback === 'function') callback(successRes);
      clientSocket.emit('host_ready', successRes);
      if (room.currentSong) {
        clientSocket.emit('play_song', room.currentSong);
      }
      broadcastState(roomId);
      return;
    }

    // TRƯỜNG HỢP 3: PHÒNG ĐÃ CÓ TV HOST ĐANG HOẠT ĐỘNG -> YÊU CẦU MÃ PIN 4 SỐ ĐANG HIỆN TRÊN TV CHÍNH
    if (hasActivePrimary || hasGracePeriod || room.hostSocketIds.size > 0) {
      if (!pin || pin !== room.pin) {
        console.warn(`⛔ [${roomId}] Secondary TV Host registration rejected for socket ${clientSocket.id}. Invalid or missing PIN (${pin || 'none'} vs ${room.pin}).`);
        const errPayload = {
          success: false,
          error: 'INVALID_PIN',
          roomId,
          message: 'Vui lòng nhập đúng 4 số PIN đang hiển thị trên màn hình TV chính!'
        };
        if (typeof callback === 'function') callback(errPayload);
        clientSocket.emit('room_host_exists', errPayload);
        clientSocket.emit('unauthorized_host', errPayload);
        return;
      }

      // Mã PIN CHÍNH XÁC -> Duyệt làm Secondary TV Host (TV phụ)
      console.log(`📺 [${roomId}] Secondary TV Host authenticated successfully with room PIN (socket: ${clientSocket.id}).`);
      room.hostSocketIds.add(clientSocket.id);
      clientSocket.join(roomId);
      clientSocket.data.roomId = roomId;
      clientSocket.data.isHost = true;
      clientSocket.data.isSecondaryHost = true;

      const successRes = {
        success: true,
        roomId,
        pin: room.pin,
        isSecondary: true,
        isPrimary: false
      };
      if (typeof callback === 'function') callback(successRes);
      clientSocket.emit('host_ready', successRes);

      // Đồng bộ ngay bài đang phát sang TV phụ
      if (room.currentSong) {
        clientSocket.emit('play_song', room.currentSong);
      }
      broadcastState(roomId);
      io.to(roomId).emit('update_members', getSortedMembers(room));
      return;
    }

    // TRƯỜNG HỢP 4: PHÒNG CHƯA CÓ HOST NÀO -> Thiết bị đầu tiên trở thành Primary TV Host!
    if (hasGracePeriod) {
      clearTimeout(hostDisconnectTimers.get(roomId)!);
      hostDisconnectTimers.delete(roomId);
    }

    const newPin = room.pin && room.pin !== '0000' ? room.pin : Math.floor(1000 + Math.random() * 9000).toString();
    room.pin = newPin;
    room.hostSocketId = clientSocket.id;
    room.hostToken = hostToken || undefined;
    room.hostSocketIds.add(clientSocket.id);

    clientSocket.join(roomId);
    clientSocket.data.roomId = roomId;
    clientSocket.data.isHost = true;
    clientSocket.data.isPrimaryHost = true;

    console.log(`📺 TV Host registered as PRIMARY for room "${roomId}" with PIN "${newPin}" (socket: ${clientSocket.id})`);

    const successRes = { success: true, roomId, pin: newPin, isPrimary: true };
    if (typeof callback === 'function') callback(successRes);
    clientSocket.emit('host_ready', successRes);
    if (room.currentSong) {
      clientSocket.emit('play_song', room.currentSong);
    }
    broadcastState(roomId);
    io.to(roomId).emit('update_members', getSortedMembers(room));
  };

  socket.on('register_host', (data: any, callback?: any) => handleHostRegister(socket, data, callback));
  socket.on('join_host', (data: any, callback?: any) => handleHostRegister(socket, data, callback));
  socket.on('host_init', (data: any, callback?: any) => handleHostRegister(socket, data, callback));
  socket.on('tv_join', (data: any, callback?: any) => handleHostRegister(socket, data, callback));

  // 2. KHÁCH XÁC THỰC MÃ PIN & THAM GIA PHÒNG (HỖ TRỢ RECONNECT TỰ ĐỘNG BẰNG USER_ID)
  socket.on('verify_and_join', (data: { roomId: string; pin: string; name?: string; userId?: string }, callback?: (res: any) => void) => {
    const roomId = (data && data.roomId ? data.roomId.trim() : '') || '';
    const pin = (data && data.pin ? data.pin.trim() : '') || '';
    const name = (data && data.name ? data.name.trim() : '') || '';
    const userId = (data && data.userId ? data.userId.trim() : '') || '';

    const room = rooms.get(roomId);
    if (!room) {
      const errRes = { success: false, code: 'ROOM_NOT_FOUND', message: 'Phòng không tồn tại hoặc TV chưa bật!' };
      if (typeof callback === 'function') callback(errRes);
      socket.emit('join_error', errRes);
      return;
    }

    if (room.pin !== pin) {
      const errRes = { success: false, code: 'PIN_INVALID', message: 'Ca hát đã kết thúc hoặc sai mã PIN. Vui lòng quét lại mã QR mới trên TV!' };
      if (typeof callback === 'function') callback(errRes);
      socket.emit('join_error', errRes);
      return;
    }

    // PIN hợp lệ! Cho vào socket room
    socket.join(roomId);
    socket.data.roomId = roomId;
    if (userId) socket.data.userId = userId;

    let member: RoomMember | null = null;
    if (name || userId) {
      const targetNameLower = name.trim().toLowerCase();

      // Kiểm tra xem socket này trước đó đang liên kết với thành viên nào khác tên không
      const prevMemberOfSocket = room.members.find((m) => m.id === socket.id && m.name.trim().toLowerCase() !== targetNameLower);
      if (prevMemberOfSocket) {
        console.log(`🎤 [${roomId}] Client changed name on verify_and_join: "${prevMemberOfSocket.name}" -> "${name}". Old name marked (off).`);
        prevMemberOfSocket.id = '';
        prevMemberOfSocket.isOnline = false;
      }

      // Tìm thành viên trùng đúng tên mới (để khôi phục nếu người mang tên này reconnect)
      let existingMemberByName = room.members.find((m) => m.name.trim().toLowerCase() === targetNameLower);

      if (existingMemberByName) {
        existingMemberByName.id = socket.id;
        if (userId) existingMemberByName.userId = userId;
        existingMemberByName.name = name;
        existingMemberByName.isOnline = true;
        member = existingMemberByName;
        console.log(`🎤 [${roomId}] Member "${member.name}" reconnected (userId: ${member.userId}, socket: ${socket.id}). Preserved Score: ${member.score}`);
      } else {
        const resolvedName = name || 'Khách';
        member = {
          id: socket.id,
          userId: userId || ('user_' + socket.id),
          name: resolvedName,
          score: 50,
          joinedAt: Date.now(),
          isOnline: true
        };
        room.members.push(member);
        console.log(`🎤 [${roomId}] New Member joined: "${resolvedName}" (userId: ${member.userId}, socket: ${socket.id}, initial score: 50). Total: ${room.members.length}`);
        io.to(roomId).emit('member_joined', { id: socket.id, userId: member.userId, name: resolvedName, score: 50 });
      }

      // Ghi nhận người tham gia vào RAM của server theo phiên bài hát (tuyệt đối không emit làm gián đoạn TV)
      recordParticipantInCurrentSong(room, member.name);

      io.to(roomId).emit('update_members', getSortedMembers(room));
      broadcastState(roomId);
    }

    const okRes = { success: true, roomId, pin, member };
    if (typeof callback === 'function') callback(okRes);
    socket.emit('join_success', okRes);

    // Gửi sync_state riêng cho client vừa vào
    const lead = getLeadSingerName(room);
    const isSingerOnline = lead ? isParticipantInCurrentSong(room, lead) : false;
    socket.emit('sync_state', {
      currentSong: room.currentSong,
      queue: room.queue,
      totalWaiting: room.queue.length,
      interactions: room.interactions,
      coSingers: room.coSingers,
      isSingerOnline
    });
    socket.emit('update_members', getSortedMembers(room));
  });

  // Client requests sync state
  socket.on('get_state', (data?: { roomId?: string }) => {
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    const lead = getLeadSingerName(room);
    const isSingerOnline = lead ? isParticipantInCurrentSong(room, lead) : false;
    socket.emit('sync_state', {
      currentSong: room.currentSong,
      queue: room.queue,
      totalWaiting: room.queue.length,
      interactions: room.interactions,
      coSingers: room.coSingers,
      isSingerOnline
    });
    socket.emit('update_members', getSortedMembers(room));
  });

  // Client requests remote unmute
  socket.on('remote_unmute', (data?: { roomId?: string }) => {
    const roomId = getSocketRoomId(data?.roomId);
    if (roomId) {
      io.to(roomId).emit('remote_unmute');
    }
  });

  // User joins room with singer name
  socket.on('join_room', (data: { name: string; roomId?: string; userId?: string }) => {
    const rawName = data && data.name ? data.name.trim() : '';
    if (!rawName) return;
    const roomId = getSocketRoomId(data?.roomId);
    socket.data.roomId = roomId;
    socket.join(roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    const userId = data && data.userId ? data.userId.trim() : '';

    io.to(roomId).emit('remote_unmute');

    const targetNameLower = rawName.toLowerCase();

    // 1. Kiểm tra xem socket này trước đó đang liên kết với thành viên nào khác tên không
    // Nếu có: Tên người cũ ngay lập tức bị gạch tên khỏi danh sách online và chuyển sang trạng thái (off) (isOnline = false), socket ID không còn gắn với tên cũ nữa.
    const prevMemberOfSocket = room.members.find((m) => m.id === socket.id && m.name.trim().toLowerCase() !== targetNameLower);
    if (prevMemberOfSocket) {
      console.log(`🎤 [${roomId}] Client renamed from "${prevMemberOfSocket.name}" to "${rawName}". Old member "${prevMemberOfSocket.name}" marked (off), socket released.`);
      prevMemberOfSocket.id = '';
      prevMemberOfSocket.isOnline = false;
    }

    // 2. Tìm xem trong phòng đã từng có ai mang đúng tên mới này chưa (để khôi phục điểm nếu chính người này reconnect lại)
    let existingMemberByName = room.members.find((m) => m.name.trim().toLowerCase() === targetNameLower);

    if (existingMemberByName) {
      existingMemberByName.id = socket.id;
      existingMemberByName.name = rawName;
      if (userId) existingMemberByName.userId = userId;
      existingMemberByName.isOnline = true;
      console.log(`🎤 [${roomId}] Member "${rawName}" reconnected (userId: ${existingMemberByName.userId}, id: ${socket.id}). Preserved Score: ${existingMemberByName.score}`);
    } else {
      // Coi tên mới là một thực thể người dùng mới hoàn toàn (New Member) với điểm số khởi tạo 50đ
      const newMember: RoomMember = {
        id: socket.id,
        userId: userId || ('user_' + socket.id),
        name: rawName,
        score: 50,
        joinedAt: Date.now(),
        isOnline: true
      };
      room.members.push(newMember);
      console.log(`🎤 [${roomId}] New Member joined: "${rawName}" (userId: ${newMember.userId}, id: ${socket.id}, initial score: 50). Total: ${room.members.length}`);
      io.to(roomId).emit('member_joined', { id: socket.id, userId: newMember.userId, name: rawName, score: 50 });
    }

    // Ghi nhận người tham gia vào RAM của server theo phiên bài hát (tuyệt đối không emit làm gián đoạn TV)
    recordParticipantInCurrentSong(room, rawName);

    const sorted = getSortedMembers(room);
    io.to(roomId).emit('update_members', sorted);
    broadcastState(roomId);
  });

  // Client submits song
  socket.on('add_song', async (data: {
    roomId?: string;
    userName?: string;
    videoId: string;
    priority?: boolean;
    title?: string;
    channelTitle?: string;
    thumbnail?: string;
    duration?: string;
  }) => {
    try {
      if (!data || !data.videoId) {
        socket.emit('error_message', 'Vui lòng cung cấp link hoặc Video ID YouTube!');
        return;
      }
      const roomId = getSocketRoomId(data?.roomId);
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error_message', 'Phòng không tồn tại hoặc đã hết phiên!');
        return;
      }

      const cleanId = extractYouTubeId(data.videoId);
      if (!cleanId) {
        socket.emit('error_message', 'Link YouTube hoặc Video ID không hợp lệ!');
        return;
      }

      io.to(roomId).emit('remote_unmute');

      let songTitle = data.title;
      let songThumb = data.thumbnail;
      let songChannel = data.channelTitle;

      if (!songTitle || !songThumb) {
        const meta = await fetchYouTubeMeta(cleanId);
        songTitle = songTitle || meta.title;
        songThumb = songThumb || meta.thumbnail;
      }

      const isPriority = Boolean(data.priority);
      const resolvedUser = (data.userName && data.userName.trim()) || 'Khách';
      const newSong: SongItem = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        userName: resolvedUser,
        requester: resolvedUser,
        videoId: cleanId,
        title: songTitle || `Karaoke Video #${cleanId}`,
        channelTitle: songChannel || '',
        thumbnail: songThumb || `https://img.youtube.com/vi/${cleanId}/mqdefault.jpg`,
        duration: data.duration || '',
        addedAt: Date.now(),
        priority: isPriority
      };

      if (!room.currentSong) {
        room.currentSong = newSong;
        room.coSingers = [];
        room.interactions = createDefaultInteractions();
        initSongSessionParticipants(room);
        if (newSong.userName) {
          recordParticipantInCurrentSong(room, newSong.userName);
        }
        io.to(roomId).emit('play_song', room.currentSong);
      } else if (isPriority) {
        room.queue.unshift(newSong);
      } else {
        room.queue.push(newSong);
      }

      broadcastState(roomId);
      socket.emit('song_added_success', {
        song: newSong,
        priority: isPriority
      });
    } catch (e) {
      console.error('Socket add_song error:', e);
      socket.emit('error_message', 'Có lỗi khi thêm bài hát vào hàng đợi');
    }
  });

  // Client gửi tương tác phản ứng (Tim 1đ, Cụng ly 5đ, Vương miện 20đ, Tên lửa 50đ, Bình luận...)
  socket.on('send_reaction', (data: {
    roomId?: string;
    type: 'heart' | 'cheers' | 'crown' | 'rocket' | 'flower' | 'clap' | 'comment';
    userName?: string;
    text?: string;
    points?: number;
  }) => {
    if (!data || !data.type) return;
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room) return;

    if (!room.currentSong) {
      socket.emit('error_message', 'Chưa có bài hát nào đang phát trên TV!');
      return;
    }

    const lead = getLeadSingerName(room);
    const isLeadOnline = lead ? isParticipantInCurrentSong(room, lead) : false;
    const hasCoSingers = room.coSingers && room.coSingers.length > 0;
    // Khóa tương tác chỉ khi: Ca sĩ chính Offline VÀ CHƯA CÓ AI hát cùng
    if (!isLeadOnline && !hasCoSingers) {
      socket.emit('error_message', 'Ca sĩ chính đang Offline và chưa có ai Hát cùng! Hãy bấm "Hát cùng" để mở khóa tương tác.');
      return;
    }

    const type = data.type;
    const defaultPoints = type === 'rocket' ? 50 : type === 'crown' ? 20 : type === 'cheers' ? 5 : type === 'flower' ? 2 : 1;
    const points = Number(data.points) || defaultPoints;
    const userName = (data.userName && data.userName.trim()) || 'Bạn bè';
    const text = (data.text || '').trim().substring(0, 30);

    // Ghi nhận người tương tác vào activeParticipantsInSong (lưu vào RAM)
    recordParticipantInCurrentSong(room, userName);

    room.userContributions[userName] = (room.userContributions[userName] || 0) + points;

    room.interactions.totalPoints += points;
    if (type === 'heart') room.interactions.hearts += 1;
    else if (type === 'flower') room.interactions.flowers += 1;
    else if (type === 'cheers') room.interactions.cheers += 1;
    else if (type === 'crown') room.interactions.crowns = (room.interactions.crowns || 0) + 1;
    else if (type === 'rocket') room.interactions.rockets = (room.interactions.rockets || 0) + 1;
    else if (type === 'clap') room.interactions.claps += 1;
    else if (type === 'comment') room.interactions.comments += 1;

    console.log(`🎉 [${roomId}] Reaction "${type}" (+${points}đ) from "${userName}". Total points: ${room.interactions.totalPoints}`);

    const reactionPayload = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type,
      userName,
      text,
      points,
      timestamp: Date.now(),
      interactions: room.interactions
    };

    io.to(roomId).emit('new_reaction', reactionPayload);
  });

  // Khán giả tham gia hát cùng ca sĩ chính
  socket.on('join_singing', (data: { roomId?: string; userName?: string }) => {
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room || !room.currentSong) return;

    const userName = (data && data.userName && data.userName.trim()) || '';
    if (!userName) return;

    // Ghi nhận người tham gia hát cùng vào activeParticipantsInSong (lưu vào RAM)
    recordParticipantInCurrentSong(room, userName);

    if (room.currentSong.userName && room.currentSong.userName.trim().toLowerCase() === userName.toLowerCase()) {
      return;
    }

    const alreadyJoined = room.coSingers.some((cs) => cs.trim().toLowerCase() === userName.toLowerCase());
    if (!alreadyJoined) {
      room.coSingers.push(userName);
      console.log(`🎤 [${roomId}] Co-singer joined: "${userName}" for song "${room.currentSong.title}". Total co-singers: ${room.coSingers.length}`);

      broadcastState(roomId);
      io.to(roomId).emit('co_singers_updated', { coSingers: room.coSingers, currentSong: room.currentSong });
    }
  });

  // Yêu cầu chốt sổ chấm điểm bài hát hiện tại
  socket.on('settle_song_score', (data?: { roomId?: string }, callback?: (res: any) => void) => {
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room) return;

    const result = settleCurrentSongScore(room);
    if (typeof callback === 'function') callback(result);
    io.to(roomId).emit('song_score_settled', result);
  });

  // Host TV video finished playing
  socket.on('song_ended', (data?: { roomId?: string }) => {
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    const now = Date.now();
    if (room.lastSongEndedAt && now - room.lastSongEndedAt < 2500) {
      return;
    }
    room.lastSongEndedAt = now;
    console.log(`🎬 [${roomId}] Host event: song_ended. Playing next in queue...`);
    playNextSong(roomId);
  });

  // Skip do lỗi phát video (không chấm điểm, không trừ điểm user, chuyển thẳng sang bài tiếp theo)
  socket.on('skip_error_song', (data?: { roomId?: string; videoId?: string }) => {
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    const now = Date.now();
    if (room.lastSongEndedAt && now - room.lastSongEndedAt < 2500) {
      return;
    }
    room.lastSongEndedAt = now;
    console.log(`⚠️ [${roomId}] Video error skip requested without scoring.`);
    playNextSong(roomId);
  });

  // Skip/Next current song manually from client
  socket.on('skip_song', (data?: { roomId?: string; noScore?: boolean }) => {
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    const now = Date.now();
    if (room.lastSongEndedAt && now - room.lastSongEndedAt < 2500) {
      return;
    }
    room.lastSongEndedAt = now;
    console.log(`⏭️ [${roomId}] Skip current song requested (noScore: ${!!data?.noScore})`);
    if (room.currentSong && !data?.noScore) {
      const scoreResult = settleCurrentSongScore(room);
      io.to(roomId).emit('song_score_settled', scoreResult);
      io.to(roomId).emit('request_skip', scoreResult);
    } else {
      playNextSong(roomId);
    }
  });

  socket.on('next_song', (data?: { roomId?: string; noScore?: boolean }) => {
    const roomId = getSocketRoomId(data?.roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    const now = Date.now();
    if (room.lastSongEndedAt && now - room.lastSongEndedAt < 2500) {
      return;
    }
    room.lastSongEndedAt = now;
    console.log(`⏭️ [${roomId}] Next song requested (noScore: ${!!data?.noScore})`);
    if (room.currentSong && !data?.noScore) {
      const scoreResult = settleCurrentSongScore(room);
      io.to(roomId).emit('song_score_settled', scoreResult);
      io.to(roomId).emit('request_skip', scoreResult);
    } else {
      playNextSong(roomId);
    }
  });

  // Đồng bộ Video & Tạm dừng / Tiếp tục giữa các TV Host
  socket.on('pause_video', (data?: { roomId?: string }) => {
    const roomId = getSocketRoomId(data?.roomId);
    console.log(`⏸️ [${roomId}] Pause video broadcasted`);
    io.to(roomId).emit('pause_video');
  });

  socket.on('resume_video', (data?: { roomId?: string }) => {
    const roomId = getSocketRoomId(data?.roomId);
    console.log(`▶️ [${roomId}] Resume video broadcasted`);
    io.to(roomId).emit('resume_video');
  });

  socket.on('sync_playback_time', (data: { roomId?: string; currentTime: number }) => {
    const roomId = getSocketRoomId(data?.roomId);
    socket.to(roomId).emit('sync_playback_time', { currentTime: data?.currentTime || 0 });
  });

  // Queue reordering
  socket.on('prioritize_queue_song', (data: { roomId?: string; id: string }) => {
    if (data && data.id) {
      const roomId = getSocketRoomId(data?.roomId);
      const room = rooms.get(roomId);
      if (!room) return;
      const idx = room.queue.findIndex((item) => item.id === data.id);
      if (idx !== -1) {
        const [targetSong] = room.queue.splice(idx, 1);
        targetSong.priority = true;
        room.queue.unshift(targetSong);
        console.log(`⚡ [${roomId}] Song prioritized: "${targetSong.title}" by ${targetSong.userName}`);
        broadcastState(roomId);
      }
    }
  });

  socket.on('move_song_up', (data: { roomId?: string; id: string }) => {
    if (data && data.id) {
      const roomId = getSocketRoomId(data?.roomId);
      const room = rooms.get(roomId);
      if (!room) return;
      const idx = room.queue.findIndex((item) => item.id === data.id);
      if (idx > 0) {
        const temp = room.queue[idx];
        room.queue[idx] = room.queue[idx - 1];
        room.queue[idx - 1] = temp;
        console.log(`▲ [${roomId}] Moved song up: "${temp.title}" (${idx} -> ${idx - 1})`);
        broadcastState(roomId);
      }
    }
  });

  socket.on('move_song_down', (data: { roomId?: string; id: string }) => {
    if (data && data.id) {
      const roomId = getSocketRoomId(data?.roomId);
      const room = rooms.get(roomId);
      if (!room) return;
      const idx = room.queue.findIndex((item) => item.id === data.id);
      if (idx !== -1 && idx < room.queue.length - 1) {
        const temp = room.queue[idx];
        room.queue[idx] = room.queue[idx + 1];
        room.queue[idx + 1] = temp;
        console.log(`▼ [${roomId}] Moved song down: "${temp.title}" (${idx} -> ${idx + 1})`);
        broadcastState(roomId);
      }
    }
  });

  socket.on('remove_from_queue', (data: { roomId?: string; id: string }) => {
    if (data && data.id) {
      const roomId = getSocketRoomId(data?.roomId);
      const room = rooms.get(roomId);
      if (!room) return;
      const removed = room.queue.find((item) => item.id === data.id);
      room.queue = room.queue.filter((item) => item.id !== data.id);
      console.log(`🗑️ [${roomId}] Removed song: "${removed?.title || data.id}"`);
      broadcastState(roomId);
    }
  });

  socket.on('remove_song', (data: { roomId?: string; id: string }) => {
    if (data && data.id) {
      const roomId = getSocketRoomId(data?.roomId);
      const room = rooms.get(roomId);
      if (!room) return;
      room.queue = room.queue.filter((item) => item.id !== data.id);
      broadcastState(roomId);
    }
  });

  socket.on('disconnect', () => {
    const targetRoomId = socket.data.roomId;

    // Quét qua các phòng để cập nhật tức thì trạng thái mất kết nối của mọi thành viên
    for (const [roomId, room] of rooms.entries()) {
      if (targetRoomId && roomId !== targetRoomId) continue;

      let roomChanged = false;

      // 1. Xử lý khi TV Host ngắt kết nối (hỗ trợ nhiều TV Host cùng phòng)
      if (socket.data.isHost || (room.hostSocketIds && room.hostSocketIds.has(socket.id)) || room.hostSocketId === socket.id) {
        console.log(`📺 [${roomId}] TV Host socket disconnected (${socket.id}).`);
        if (room.hostSocketIds) {
          room.hostSocketIds.delete(socket.id);
        }

        // Nếu socket vừa ngắt là Primary Host
        if (room.hostSocketId === socket.id) {
          let nextHostId: string | undefined;
          if (room.hostSocketIds && room.hostSocketIds.size > 0) {
            for (const sid of room.hostSocketIds) {
              const s = io.sockets.sockets.get(sid);
              if (s && s.connected) {
                nextHostId = sid;
                break;
              }
            }
          }

          if (nextHostId) {
            room.hostSocketId = nextHostId;
            console.log(`📺 [${roomId}] Promoted secondary host (${nextHostId}) to primary host.`);
          } else {
            if (hostDisconnectTimers.has(roomId)) {
              clearTimeout(hostDisconnectTimers.get(roomId)!);
              hostDisconnectTimers.delete(roomId);
            }

            const timer = setTimeout(() => {
              if (room.hostSocketId === socket.id) {
                console.log(`📺 [${roomId}] TV Host 15s grace period expired without reconnect. Releasing host lock.`);
                room.hostSocketId = undefined;
                room.hostToken = undefined;
              }
              hostDisconnectTimers.delete(roomId);
            }, 15000);

            hostDisconnectTimers.set(roomId, timer);
          }
        }
      }

      // 2. Xử lý khi BẤT KỲ thành viên nào ngắt kết nối (báo (off) ngay lập tức cho toàn phòng)
      const member = room.members.find((m) => m.id === socket.id);
      if (member) {
        console.log(`👋 [${roomId}] Member disconnected: "${member.name}" (userId: ${member.userId}, id: ${socket.id}). Báo (off) và giữ nguyên điểm.`);
        member.id = '';
        member.isOnline = false;
        roomChanged = true;
      }

      if (roomChanged) {
        io.to(roomId).emit('update_members', getSortedMembers(room));
        broadcastState(roomId);
      }
    }
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Development mode with Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    });

    // Helper render Host TV index.html
    const serveHost = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        const filePath = path.join(rootDir, 'index.html');
        let html = fs.readFileSync(filePath, 'utf-8');
        html = await vite.transformIndexHtml(req.url, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        next(e);
      }
    };

    // Helper render Client Remote client.html
    const serveClient = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        const filePath = path.join(rootDir, 'client.html');
        let html = fs.readFileSync(filePath, 'utf-8');
        html = await vite.transformIndexHtml(req.url, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        next(e);
      }
    };

    // 2. BẢO MẬT VÀ PHÂN QUYỀN MÀN HÌNH TV HOST:
    // Route /tv: Phục vụ màn hình TV Host
    app.get('/tv', async (req, res, next) => {
      res.cookie('karaoke_is_tv', '1', { path: '/', maxAge: 86400 * 1000, sameSite: 'lax' });
      await serveHost(req, res, next);
    });

    // Route /client và /client.html: Giao diện chọn bài cho khách
    app.get(['/client', '/client.html'], async (req, res, next) => {
      await serveClient(req, res, next);
    });

    // Chặn người ngoài truy cập trực tiếp vào /index.html
    app.get('/index.html', (req, res) => {
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect('/client.html' + query);
    });

    // Route / :
    // - Nếu trình duyệt có cookie karaoke_is_tv (TV Host vừa replaceState sang / để giấu link): phục vụ TV Host
    // - Nếu là khách truy cập vào trang chủ: TUYỆT ĐỐI KHÔNG hiển thị màn hình video TV, chuyển hướng sang /client.html
    app.get('/', async (req, res, next) => {
      const cookies = parseCookies(req);
      if (cookies.karaoke_is_tv) {
        return serveHost(req, res, next);
      }
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect('/client.html' + query);
    });

    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.join(rootDir, 'dist');
    app.use(express.static(distPath));

    app.get('/tv', (_req, res) => {
      res.cookie('karaoke_is_tv', '1', { path: '/', maxAge: 86400 * 1000, sameSite: 'lax' });
      res.sendFile(path.join(distPath, 'index.html'));
    });

    app.get(['/client', '/client.html'], (_req, res) => {
      res.sendFile(path.join(distPath, 'client.html'));
    });

    app.get('/index.html', (req, res) => {
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect('/client.html' + query);
    });

    app.get('/', (req, res) => {
      const cookies = parseCookies(req);
      if (cookies.karaoke_is_tv) {
        return res.sendFile(path.join(distPath, 'index.html'));
      }
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect('/client.html' + query);
    });

    app.get('*', (req, res) => {
      if (req.path === '/tv') {
        res.cookie('karaoke_is_tv', '1', { path: '/', maxAge: 86400 * 1000, sameSite: 'lax' });
        return res.sendFile(path.join(distPath, 'index.html'));
      }
      if (req.path.startsWith('/client')) {
        return res.sendFile(path.join(distPath, 'client.html'));
      }
      const cookies = parseCookies(req);
      if (cookies.karaoke_is_tv) {
        return res.sendFile(path.join(distPath, 'index.html'));
      }
      res.redirect('/client.html');
    });
  }

  httpServer.on('error', (err: any) => {
    console.warn(`⚠️ Server warning on port ${PORT}:`, err.message);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('--------------------------------------------------');
    console.log(`🎤 Karaoke Server running on Port: ${PORT}`);
    console.log('📺 TV Host Screen:');
    console.log(`   - Trên máy tính:  http://localhost:${PORT}/tv`);
    console.log(`   - Trên TV / Mạng: http://[IP máy chủ]:${PORT}/tv`);
    console.log(`📱 Client Remote:   http://[IP máy chủ]:${PORT}/client.html?room=phong1`);
    console.log('--------------------------------------------------');
  });
}

startServer();

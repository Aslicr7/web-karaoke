import QRCode from 'qrcode';
import { RoomMember, SongItem, SyncStateData } from './types';

// Declare YouTube API global
declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
    io: any;
  }
}

declare const io: any;

// Elements
const playerContainer = document.getElementById('player-container') as HTMLDivElement;
const idleScreen = document.getElementById('idle-screen') as HTMLDivElement;
const screenBlocker = document.getElementById('screen-blocker') as HTMLDivElement;

// 2. Floating Top Song Pill Elements
const topSongPill = document.getElementById('top-song-pill') as HTMLElement;
const topPillMarquee = document.getElementById('top-pill-marquee') as HTMLElement;
const tvInteractionBadge = document.getElementById('tv-interaction-badge') as HTMLElement;
const tvInteractionPts = document.getElementById('tv-interaction-pts') as HTMLElement;
const tvInteractionSep = document.getElementById('tv-interaction-sep') as HTMLElement;

// Floating Reactions & Danmaku Containers
const floatingReactionsContainer = document.getElementById('floating-reactions-container') as HTMLDivElement;
const danmakuContainer = document.getElementById('danmaku-container') as HTMLDivElement;

// 3. Màn hình Chấm điểm Karaoke Elements (#score-modal / #karaoke-score-overlay)
const karaokeScoreOverlay = (document.getElementById('score-modal') || document.getElementById('karaoke-score-overlay')) as HTMLDivElement;
const scoreSongTitleEl = document.getElementById('score-song-title') as HTMLElement;
const scoreCommentEl = document.getElementById('score-comment') as HTMLElement;
const scoreNumberEl = document.getElementById('score-number') as HTMLElement;
const scoreBreakdownListEl = document.getElementById('score-breakdown-list') as HTMLElement;
const scoreCountdownNumEl = document.getElementById('score-countdown-num') as HTMLElement;
const scoreCountdownTextEl = document.getElementById('score-countdown-text') as HTMLElement;

let latestQueue: SongItem[] = [];
let isWaitingForNextSongWithScore = false;
let currentSongInteractionPoints = 0;

// Cập nhật hiển thị Badge Tương tác trên màn hình TV (Giấu kín tổng điểm để tăng kịch tính)
function updateTVInteractionBadge(points: number) {
  currentSongInteractionPoints = points;
  // Tổng điểm tương tác được giấu kín trong suốt bài hát theo yêu cầu kịch tính
}

// -------------------------------------------------------------
// HỆ THỐNG HIỆU ỨNG TƯƠNG TÁC TV: PHÁO HOA TÊN LỬA 50 Đ & PHẢN ỨNG
// -------------------------------------------------------------
const rocketCanvas = document.getElementById('rocket-canvas') as HTMLCanvasElement | null;
let rocketCtx: CanvasRenderingContext2D | null = null;
if (rocketCanvas) {
  rocketCtx = rocketCanvas.getContext('2d');
  const resizeRocketCanvas = () => {
    if (rocketCanvas) {
      rocketCanvas.width = window.innerWidth;
      rocketCanvas.height = window.innerHeight;
    }
  };
  resizeRocketCanvas();
  window.addEventListener('resize', resizeRocketCanvas);
}

interface RocketConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  decay: number;
  shape: 'rect' | 'circle' | 'star';
}

let activeRocketConfetti: RocketConfettiParticle[] = [];
let rocketConfettiAnimId: number | null = null;

function runRocketConfettiLoop() {
  if (!rocketCtx || !rocketCanvas) return;

  rocketCtx.clearRect(0, 0, rocketCanvas.width, rocketCanvas.height);

  for (let i = activeRocketConfetti.length - 1; i >= 0; i--) {
    const p = activeRocketConfetti[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15; // trọng lực rơi nhẹ
    p.vx *= 0.985; // lực cản không khí
    p.vy *= 0.985;
    p.rotation += p.rotationSpeed;
    p.opacity -= p.decay;

    if (p.opacity <= 0 || p.y > rocketCanvas.height + 60) {
      activeRocketConfetti.splice(i, 1);
      continue;
    }

    rocketCtx.save();
    rocketCtx.translate(p.x, p.y);
    rocketCtx.rotate(p.rotation);
    rocketCtx.globalAlpha = Math.max(0, p.opacity);
    rocketCtx.fillStyle = p.color;

    if (p.shape === 'rect') {
      rocketCtx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
    } else if (p.shape === 'circle') {
      rocketCtx.beginPath();
      rocketCtx.arc(0, 0, p.width / 2, 0, Math.PI * 2);
      rocketCtx.fill();
    } else {
      // Ngôi sao lấp lánh (Sparkle Star)
      rocketCtx.beginPath();
      const spikes = 5;
      const outerRadius = p.width;
      const innerRadius = p.width / 2;
      const step = Math.PI / spikes;

      rocketCtx.moveTo(0, -outerRadius);
      for (let s = 0; s < spikes; s++) {
        const x = Math.cos((Math.PI / 2 * 3) + s * step * 2) * outerRadius;
        const y = Math.sin((Math.PI / 2 * 3) + s * step * 2) * outerRadius;
        rocketCtx.lineTo(x, y);

        const inX = Math.cos((Math.PI / 2 * 3) + (s * 2 + 1) * step) * innerRadius;
        const inY = Math.sin((Math.PI / 2 * 3) + (s * 2 + 1) * step) * innerRadius;
        rocketCtx.lineTo(inX, inY);
      }
      rocketCtx.closePath();
      rocketCtx.fill();
    }

    rocketCtx.restore();
  }

  if (activeRocketConfetti.length > 0) {
    rocketConfettiAnimId = requestAnimationFrame(runRocketConfettiLoop);
  } else {
    rocketCtx.clearRect(0, 0, rocketCanvas.width, rocketCanvas.height);
    rocketConfettiAnimId = null;
  }
}

// Bắn chùm pháo hoa kim tuyến phủ kín màn hình TV
function launchScreenFireworks(originX: number, originY: number) {
  if (!rocketCanvas) return;
  const colors = [
    '#f59e0b', '#fbbf24', '#fde047', '#ef4444', '#f43f5e', 
    '#ec4899', '#8b5cf6', '#a855f7', '#6366f1', '#3b82f6', 
    '#06b6d4', '#10b981', '#ffffff'
  ];

  for (let i = 0; i < 220; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 24 + 6;
    const shape: 'rect' | 'circle' | 'star' = Math.random() < 0.5 ? 'rect' : Math.random() < 0.8 ? 'star' : 'circle';
    activeRocketConfetti.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed * (Math.random() * 0.9 + 0.5),
      vy: Math.sin(angle) * speed * 0.85 - (Math.random() * 7 + 2),
      width: Math.random() * 11 + 5,
      height: Math.random() * 18 + 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.28,
      opacity: 1,
      decay: Math.random() * 0.007 + 0.0035,
      shape
    });
  }

  if (!rocketConfettiAnimId) {
    rocketConfettiAnimId = requestAnimationFrame(runRocketConfettiLoop);
  }
}

// Tổng hợp âm thanh tên lửa phóng lên đỉnh và phát nổ thành chuỗi hợp âm chúc mừng
function playRocketCelebrationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Giai đoạn 1: Tiếng rít động cơ tên lửa xé gió bay lên (Whoosh)
    const whooshOsc = ctx.createOscillator();
    const whooshGain = ctx.createGain();
    whooshOsc.type = 'sawtooth';
    whooshOsc.frequency.setValueAtTime(130, ctx.currentTime);
    whooshOsc.frequency.exponentialRampToValueAtTime(750, ctx.currentTime + 0.8);

    whooshGain.gain.setValueAtTime(0.01, ctx.currentTime);
    whooshGain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.45);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.85);

    whooshOsc.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    whooshOsc.start(ctx.currentTime);
    whooshOsc.stop(ctx.currentTime + 0.85);

    // Giai đoạn 2: Tiếng nổ tung chấn động và chùm hợp âm pháo hoa chúc mừng
    setTimeout(() => {
      try {
        if (ctx.state === 'suspended') ctx.resume();

        // 1. Tiếng nổ trầm vang (Low-frequency boom noise)
        const bufferSize = Math.floor(ctx.sampleRate * 0.6);
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let j = 0; j < bufferSize; j++) {
          output[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.15));
        }

        const boomSource = ctx.createBufferSource();
        boomSource.buffer = noiseBuffer;
        const boomFilter = ctx.createBiquadFilter();
        boomFilter.type = 'lowpass';
        boomFilter.frequency.value = 400;

        const boomGain = ctx.createGain();
        boomGain.gain.setValueAtTime(0.45, ctx.currentTime);
        boomGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

        boomSource.connect(boomFilter);
        boomFilter.connect(boomGain);
        boomGain.connect(ctx.destination);
        boomSource.start(ctx.currentTime);

        // 2. Chuỗi hợp âm pháo hoa chúc mừng hoàng gia (Fanfare arpeggios: C5 - E5 - G5 - C6 - E6 - G6)
        const fanfareNotes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
        fanfareNotes.forEach((freq, idx) => {
          const noteOsc = ctx.createOscillator();
          const noteGain = ctx.createGain();
          noteOsc.type = 'triangle';
          noteOsc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.07);

          noteGain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.07);
          noteGain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + idx * 0.07 + 0.03);
          noteGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.07 + 1.4);

          noteOsc.connect(noteGain);
          noteGain.connect(ctx.destination);
          noteOsc.start(ctx.currentTime + idx * 0.07);
          noteOsc.stop(ctx.currentTime + idx * 0.07 + 1.45);
        });
      } catch (e) {
        console.warn('Detonation sound error:', e);
      }
    }, 800);
  } catch (err) {
    console.warn('Cannot play rocket sound:', err);
  }
}

// Xử lý hiệu ứng QUÀ TRÙM TÊN LỬA 50 Đ
function spawnRocketBlast(userName: string) {
  if (!floatingReactionsContainer) return;

  // 1. Kích hoạt âm thanh phóng tên lửa và tiếng nổ chúc mừng
  playRocketCelebrationSound();

  // 2. Tạo phần tử tên lửa khổng lồ bay vút từ đáy màn hình lên đỉnh
  const rocketEl = document.createElement('div');
  rocketEl.className = 'rocket-blast-item flex flex-col items-center pointer-events-none select-none';

  rocketEl.innerHTML = `
    <div class="px-5 py-2 rounded-full bg-gradient-to-r from-orange-600 via-rose-600 to-amber-500 text-white font-black text-sm sm:text-base md:text-xl shadow-2xl border-2 border-yellow-300 mb-3 flex items-center gap-2 shadow-orange-500/50">
      <span class="text-2xl animate-spin">🚀</span>
      <span>${escapeHtml(userName)} BẮN TÊN LỬA +50 Đ!</span>
      <span class="text-2xl animate-pulse">💥</span>
    </div>
    <div class="relative flex flex-col items-center">
      <span class="text-7xl sm:text-8xl md:text-9xl filter drop-shadow-[0_0_35px_rgba(249,115,22,1)] transform -rotate-45 block">🚀</span>
      <!-- Đuôi lửa phản lực cháy rực -->
      <div class="w-10 h-24 bg-gradient-to-t from-transparent via-yellow-400 to-orange-600 rounded-full blur-sm -mt-4 animate-pulse"></div>
    </div>
  `;

  floatingReactionsContainer.appendChild(rocketEl);

  // 3. Khi tên lửa bay lên đến đỉnh và nổ tung (~850ms)
  setTimeout(() => {
    // Rung nhẹ màn hình TV (#tv-container hoặc body lắc nhẹ animation screen-shake)
    const tvContainer = document.getElementById('tv-container') || document.body;
    tvContainer.classList.remove('screen-shake');
    void tvContainer.offsetWidth; // kích hoạt reflow
    tvContainer.classList.add('screen-shake');
    setTimeout(() => tvContainer.classList.remove('screen-shake'), 900);

    // Vòng sóng xung kích tỏa ra tại điểm nổ
    const shockwave = document.createElement('div');
    shockwave.className = 'rocket-shockwave-ring';
    shockwave.style.left = '50%';
    shockwave.style.top = '22%';
    shockwave.style.width = '240px';
    shockwave.style.height = '240px';
    floatingReactionsContainer.appendChild(shockwave);

    setTimeout(() => {
      if (shockwave.parentNode) shockwave.parentNode.removeChild(shockwave);
    }, 1300);

    // Kích hoạt chùm pháo hoa kim tuyến phủ kín màn hình
    const canvasWidth = rocketCanvas ? rocketCanvas.width : window.innerWidth;
    const canvasHeight = rocketCanvas ? rocketCanvas.height : window.innerHeight;
    launchScreenFireworks(canvasWidth / 2, canvasHeight * 0.22);

    // Xóa phần tử tên lửa
    if (rocketEl.parentNode) {
      rocketEl.parentNode.removeChild(rocketEl);
    }
  }, 850);
}

// Tạo hiệu ứng bong bóng phản ứng (Floating Bubbles) bay lơ lửng từ dưới lên
function spawnFloatingReaction(type: string, userName: string) {
  if (!floatingReactionsContainer) return;

  const bubble = document.createElement('div');
  bubble.className = 'floating-bubble-item flex items-center gap-1.5 bg-black/75 backdrop-blur-md border border-white/20 px-3 py-1.5 rounded-full shadow-2xl';

  // Tọa độ ngang ngẫu nhiên từ 10% đến 80% chiều rộng màn hình
  const randomLeft = Math.floor(Math.random() * 70) + 12;
  bubble.style.left = `${randomLeft}%`;

  // Độ dạt ngang ngẫu nhiên -40px đến +40px
  const randomDriftX = (Math.random() - 0.5) * 80;
  bubble.style.setProperty('--drift-x', `${randomDriftX}px`);

  // Thời gian bay từ 3.8s đến 5s
  const randomDuration = (Math.random() * 1.2 + 3.8).toFixed(1);
  bubble.style.animationDuration = `${randomDuration}s`;

  let emoji = '❤️';
  let badgeColor = 'text-rose-400';
  const isCrown = type === 'crown';

  if (type === 'flower') {
    emoji = '💐';
    badgeColor = 'text-emerald-400';
  } else if (type === 'cheers') {
    emoji = '🍻';
    badgeColor = 'text-amber-400';
  } else if (type === 'clap') {
    emoji = '👏';
    badgeColor = 'text-indigo-400';
  } else if (isCrown) {
    emoji = '👑';
    badgeColor = 'text-yellow-300';
    bubble.className = 'floating-bubble-item flex items-center gap-2 bg-gradient-to-r from-amber-950/90 to-neutral-950/90 backdrop-blur-md border border-yellow-500/60 px-3.5 py-1.5 rounded-full shadow-2xl shadow-yellow-500/30';
  }

  bubble.innerHTML = `
    <span class="text-2xl sm:text-3xl filter drop-shadow ${isCrown ? 'crown-sparkle-fx' : ''}">${emoji}</span>
    <span class="text-xs sm:text-sm font-black ${badgeColor} drop-shadow tracking-wide max-w-[130px] truncate">${escapeHtml(userName)}</span>
    ${isCrown ? '<span class="text-[10px] font-extrabold text-yellow-300 bg-yellow-500/20 px-1.5 py-0.5 rounded border border-yellow-500/40 shrink-0">+20đ</span>' : ''}
  `;

  floatingReactionsContainer.appendChild(bubble);

  setTimeout(() => {
    if (bubble.parentNode) {
      bubble.parentNode.removeChild(bubble);
    }
  }, parseFloat(randomDuration) * 1000 + 200);
}

// Tạo hiệu ứng bình luận bay ngang màn hình TV (Danmaku)
function spawnDanmakuComment(text: string, userName: string) {
  if (!danmakuContainer || !text) return;

  const danmaku = document.createElement('div');
  danmaku.className = 'danmaku-item flex items-center gap-2.5 text-xl sm:text-2xl md:text-3xl font-black text-white';

  // Độ cao ngẫu nhiên từ 15% đến 72%
  const randomTop = Math.floor(Math.random() * 57) + 15;
  danmaku.style.top = `${randomTop}%`;

  // Thời gian trôi từ 7.5s đến 10s
  const randomDuration = (Math.random() * 2.5 + 7.5).toFixed(1);
  danmaku.style.animationDuration = `${randomDuration}s`;

  const colors = ['#fde047', '#f472b6', '#38bdf8', '#4ade80', '#c084fc', '#fb923c', '#ffffff'];
  const textColor = colors[Math.floor(Math.random() * colors.length)];
  danmaku.style.color = textColor;

  danmaku.innerHTML = `
    <span class="px-2.5 py-0.5 rounded-full bg-black/70 border border-white/20 text-xs sm:text-sm font-black text-amber-300">
      💬 ${escapeHtml(userName)}
    </span>
    <span>${escapeHtml(text)}</span>
  `;

  danmakuContainer.appendChild(danmaku);

  setTimeout(() => {
    if (danmaku.parentNode) {
      danmaku.parentNode.removeChild(danmaku);
    }
  }, parseFloat(randomDuration) * 1000 + 200);
}

let currentTopPillHtml = '';

// Helper cập nhật thanh con nhộng bài hát trên TV với hiệu ứng chữ cuộn mượt mà (Marquee)
function renderTopSongPill(htmlContent: string) {
  currentTopPillHtml = htmlContent;
  const container = document.getElementById('top-pill-marquee');
  if (!container) return;

  container.innerHTML = '';
  const testSpan = document.createElement('div');
  testSpan.className = 'inline-flex items-center whitespace-nowrap mx-auto';
  testSpan.innerHTML = htmlContent;
  container.appendChild(testSpan);

  // Kiểm tra nếu chiều dài chữ vượt quá khung hiển thị -> kích hoạt marquee track chạy cuộn liên tục mượt mà
  requestAnimationFrame(() => {
    if (testSpan.scrollWidth > container.clientWidth + 4) {
      container.innerHTML = '';
      const track = document.createElement('div');
      track.className = 'marquee-track';

      const copy1 = document.createElement('div');
      copy1.className = 'inline-flex items-center whitespace-nowrap pr-14 shrink-0';
      copy1.innerHTML = htmlContent;

      const copy2 = document.createElement('div');
      copy2.className = 'inline-flex items-center whitespace-nowrap pr-14 shrink-0';
      copy2.innerHTML = htmlContent;

      track.appendChild(copy1);
      track.appendChild(copy2);
      container.appendChild(track);
    }
  });
}

// Tự động căn chỉnh lại Marquee khi kích thước màn hình TV thay đổi
window.addEventListener('resize', () => {
  if (currentTopPillHtml) {
    renderTopSongPill(currentTopPillHtml);
  }
});

const toastEl = document.getElementById('toast') as HTMLDivElement;

// QR Code Canvas & Member List elements
const qrCanvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
const membersCountBadge = document.getElementById('members-count-badge') as HTMLElement;
const membersEmptyHint = document.getElementById('members-empty-hint') as HTMLElement;
const membersListEl = document.getElementById('members-list') as HTMLElement;
const memberJoinToast = document.getElementById('member-join-toast') as HTMLElement;
const memberJoinToastText = document.getElementById('member-join-toast-text') as HTMLElement;
let memberJoinToastTimeout: any = null;

// DOM Elements màn hình chào & Nút kích hoạt ban đầu
const tvActivationOverlay = document.getElementById('tv-activation-overlay') as HTMLElement;
const btnStartTv = document.getElementById('btn-start-tv') as HTMLButtonElement;
let isTvActivated = false;
let audioContext: AudioContext | null = null;

// 1. TỰ ĐỘNG LẤY HOẶC SINH MÃ PHÒNG VÀ CẬP NHẬT URL TV HOST
const urlParams = new URLSearchParams(window.location.search);
let targetRoomId = (urlParams.get('room') || '').trim();
if (!targetRoomId) {
  // Nếu người dùng truy cập /tv mà không có ?room= trên URL:
  // Tự động tạo một tên phòng ngẫu nhiên (ví dụ: 'phong' + Math.floor(1000 + Math.random() * 9000))
  targetRoomId = 'phong' + Math.floor(1000 + Math.random() * 9000);
}
localStorage.setItem('karaoke_tv_room', targetRoomId);

// 2. CƠ CHẾ ĐỌC MÃ PIN & TỰ ĐỘNG KẾT NỐI CHO TV PHỤ (MULTI-SCREEN)
const pinFromUrl = urlParams.get('pin');
if (pinFromUrl && pinFromUrl.trim()) {
  localStorage.setItem('karaoke_tv_pin', pinFromUrl.trim());
}
let currentTvPin = (pinFromUrl && pinFromUrl.trim()) || localStorage.getItem('karaoke_tv_pin') || '';

// Tự động cập nhật lại thanh địa chỉ URL bằng window.history.replaceState thành /tv?room=[tên_phòng_vừa_tạo] để hiển thị rõ ràng
try {
  const cleanParams = new URLSearchParams(window.location.search);
  cleanParams.delete('secret');
  cleanParams.delete('secretToken');
  cleanParams.set('room', targetRoomId);
  const cleanUrl = `/tv?${cleanParams.toString()}`;
  window.history.replaceState({}, '', cleanUrl);
  document.title = `Web Karaoke - Phòng ${targetRoomId} (TV Host)`;
} catch (e) {
  console.warn('Cannot replaceState:', e);
}

// Session token cho TV Host (giữ nguyên khi F5 để nhận diện cùng thiết bị)
let hostToken = sessionStorage.getItem('karaoke_host_token');
if (!hostToken) {
  hostToken = 'ht_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  sessionStorage.setItem('karaoke_host_token', hostToken);
}

let currentRoomId = targetRoomId;
let currentPin = '';
let isPrimaryHost = false;
let isSecondaryHost = false;

// Hiển thị màn hình khóa nhập mã PIN cho Màn hình TV Phụ
function showTvPinModal(message?: string) {
  const modal = document.getElementById('tv-pin-modal');
  const errEl = document.getElementById('tv-pin-error');
  const inputEl = document.getElementById('tv-pin-input') as HTMLInputElement | null;
  const gotoClientBtn = document.getElementById('btn-goto-client') as HTMLAnchorElement | null;

  if (gotoClientBtn) {
    gotoClientBtn.href = `/client.html?room=${encodeURIComponent(currentRoomId)}`;
  }

  if (modal) {
    modal.classList.remove('hidden');
  }

  if (errEl) {
    if (message) {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }
  }

  if (inputEl) {
    inputEl.value = currentTvPin || '';
    setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 150);
  }
}

function hideTvPinModal() {
  const modal = document.getElementById('tv-pin-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function initTvPinForm() {
  const form = document.getElementById('tv-pin-form');
  const inputEl = document.getElementById('tv-pin-input') as HTMLInputElement | null;
  if (form && inputEl) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = inputEl.value.trim();
      if (!val) return;
      currentTvPin = val;
      localStorage.setItem('karaoke_tv_pin', val);
      showToast('🔄 Đang xác thực mã PIN TV...', 2000);
      registerAsHost();
    });
  }
}

// Khởi tạo form khi tải trang
initTvPinForm();

// Tùy chọn render mã QR điều khiển tự động
const qrCompactOptions = {
  width: 68,
  margin: 0,
  color: {
    dark: '#000000',
    light: '#ffffff'
  },
  errorCorrectionLevel: 'M' as const
};

function updateTvQrAndPin(roomId: string, pin: string) {
  currentRoomId = roomId;
  currentPin = pin;
  const pinEl = document.getElementById('tv-pin-text');
  if (pinEl) {
    pinEl.textContent = pin;
  }

  // Cập nhật tiêu đề trang hiển thị tên phòng rõ ràng
  try {
    document.title = `Web Karaoke - Phòng ${roomId} (TV Host)`;
  } catch {}

  // Đảm bảo URL trình duyệt giữ nguyên tham số ?room=... công khai
  try {
    const currentUrlParams = new URLSearchParams(window.location.search);
    if (currentUrlParams.get('room') !== roomId) {
      currentUrlParams.set('room', roomId);
      const newQuery = currentUrlParams.toString();
      const newUrl = newQuery ? `${window.location.pathname}?${newQuery}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  } catch (e) {
    console.warn('Cannot update room in URL:', e);
  }

  const clientUrl = `${window.location.origin}/client.html?room=${encodeURIComponent(roomId)}&pin=${encodeURIComponent(pin)}`;
  if (qrCanvas) {
    QRCode.toCanvas(qrCanvas, clientUrl, qrCompactOptions, (err) => {
      if (err) console.error('Lỗi khi vẽ mã QR TV Host:', err);
    });
  }
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let currentCoSingers: string[] = [];
let latestMembersList: RoomMember[] = [];
let isCurrentSingerOnline: boolean = true;

// 3. HIỂN THỊ BẢNG THÀNH VIÊN VÀ ĐIỂM SỐ (SẮP XẾP GIẢM DẦN THEO ĐIỂM SỐ TỪ CAO XUỐNG THẤP)
function renderMembers(members: RoomMember[]) {
  const sortedMembers = [...(members || [])].sort((a, b) => {
    const scoreB = (b.score ?? (b as any).points ?? 0);
    const scoreA = (a.score ?? (a as any).points ?? 0);
    return scoreB - scoreA;
  });
  latestMembersList = sortedMembers;
  if (membersCountBadge) {
    membersCountBadge.textContent = String(latestMembersList.length);
  }

  if (!sortedMembers || sortedMembers.length === 0) {
    if (membersEmptyHint) membersEmptyHint.classList.remove('hidden');
    if (membersListEl) {
      membersListEl.innerHTML = '';
      membersListEl.classList.add('hidden');
    }
    return;
  }

  const activeSinger = currentSongData && currentSongData.userName ? currentSongData.userName.trim().toLowerCase() : '';
  const coSingersLower = currentCoSingers.map((cs) => cs.trim().toLowerCase());

  if (membersEmptyHint) membersEmptyHint.classList.add('hidden');
  if (membersListEl) {
    membersListEl.classList.remove('hidden');
    membersListEl.innerHTML = sortedMembers
      .map(
        (m) => {
          const mLower = (m.name || '').trim().toLowerCase();
          const isMainSinger = activeSinger && mLower === activeSinger;
          const isCoSinger = coSingersLower.includes(mLower);
          const isSinging = isMainSinger || isCoSinger;

          const isOffline = m.isOnline === false || !m.isOnline;
          let statusBadge = '';
          if (isMainSinger) {
            if (isCurrentSingerOnline && !isOffline) {
              statusBadge = '<span class="text-[9px] text-amber-400 font-bold shrink-0">(Chính)</span>';
            } else {
              statusBadge = '<span class="text-[9px] text-red-400 font-bold shrink-0 animate-pulse">(Chính) (off)</span>';
            }
          } else if (isCoSinger) {
            if (isOffline) {
              statusBadge = '<span class="text-[9px] text-red-300 font-bold shrink-0">(Phụ) <span class="text-red-400 font-black animate-pulse">(off)</span></span>';
            } else {
              statusBadge = '<span class="text-[9px] text-red-300 font-bold shrink-0">(Phụ)</span>';
            }
          } else if (isOffline) {
            statusBadge = '<span class="text-[9px] text-red-400 font-bold shrink-0 animate-pulse">(off)</span>';
          }

          return `
          <div class="flex items-center justify-between text-[11px] ${
            isSinging
              ? 'bg-red-950/70 border-red-500/60 shadow-md shadow-red-950/40'
              : isOffline
              ? 'bg-[#121212]/80 border-[#3f3f3f]/50 opacity-60'
              : 'bg-[#272727] border-[#3f3f3f]/70'
          } hover:bg-[#383838] px-2 py-1 rounded-lg border transition group">
            <span class="font-semibold text-[#f1f1f1] truncate pr-1 flex items-center gap-1.5 min-w-0" title="${escapeHtml(m.name)}">
              ${isSinging ? '<span class="text-xs shrink-0 animate-bounce" title="Đang hát">🎤</span>' : ''}
              <span class="truncate ${isSinging ? 'text-amber-300 font-extrabold' : ''}">${escapeHtml(m.name)}</span>
              ${statusBadge}
            </span>
            <span class="text-amber-400 font-bold text-[10px] shrink-0 whitespace-nowrap bg-amber-400/10 border border-amber-400/20 px-1 py-0.2 rounded">
              ${m.score ?? (m as any).points ?? 0} đ
            </span>
          </div>
        `;
        }
      )
      .join('');
  }
}

// Hiển thị thông báo nhẹ trên TV khi có thành viên mới vào phòng
function showMemberJoinToast(name: string) {
  if (!memberJoinToast || !memberJoinToastText) return;
  memberJoinToastText.textContent = `${name} đã vào phòng!`;
  memberJoinToast.classList.remove('hidden');

  requestAnimationFrame(() => {
    memberJoinToast.classList.remove('scale-95', 'opacity-0');
    memberJoinToast.classList.add('scale-100', 'opacity-100');
  });

  if (memberJoinToastTimeout) clearTimeout(memberJoinToastTimeout);
  memberJoinToastTimeout = setTimeout(() => {
    memberJoinToast.classList.remove('scale-100', 'opacity-100');
    memberJoinToast.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
      memberJoinToast.classList.add('hidden');
    }, 300);
  }, 3500);
}

// Initialize Socket.io (tự động nhận diện host và port từ trình duyệt)
const socket = typeof io === 'function' ? io() : window.io();

let player: any = null;
let isPlayerReady = false;
let pendingVideoId: string | null = null;
let currentPlayingId: string | null = null;
let hasUserInteracted = false;
let errorSkipTimeout: any = null;

// 3. Trạng thái chấm điểm Karaoke & Theo dõi thời gian bài hát
let isScoringActive = false;
let scoreCountdownInterval: any = null;
let timeCheckInterval: any = null;
let currentSongData: SongItem | null = null;

function showToast(msg: string, duration = 3500) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.classList.add('opacity-100');
  setTimeout(() => {
    toastEl.classList.remove('opacity-100');
    toastEl.classList.add('hidden');
  }, duration);
}

// Quản lý Overlay / Banner "Chạm để bật âm thanh"
function showUnmuteBanner() {
  const unmuteBanner = document.getElementById('unmute-banner');
  if (unmuteBanner) {
    unmuteBanner.classList.remove('hidden');
  }
}

function hideUnmuteBanner() {
  const unmuteBanner = document.getElementById('unmute-banner');
  if (unmuteBanner) {
    unmuteBanner.classList.add('hidden');
  }
}

function setupUnmuteBanner() {
  const unmuteBanner = document.getElementById('unmute-banner');
  if (unmuteBanner) {
    const handleUnmuteClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      autoUnmutePlayer();
      showToast('🔊 Đã mở âm thanh TV', 2500);
    };
    unmuteBanner.addEventListener('click', handleUnmuteClick);
    unmuteBanner.addEventListener('touchend', handleUnmuteClick);
  }
}

setupUnmuteBanner();

// TỰ ĐỘNG BẬT ÂM THANH TV (AUTO-UNMUTE)
function autoUnmutePlayer() {
  hasUserInteracted = true;
  hideUnmuteBanner();
  if (isPlayerReady && player) {
    try {
      if (typeof player.unMute === 'function') {
        player.unMute();
      }
      if (typeof player.setVolume === 'function') {
        player.setVolume(100);
      }
      console.log('🔊 TV Player unmuted successfully');
    } catch (e) {
      console.warn('Auto-unmute error:', e);
    }
  }
  if (audioContext && audioContext.state === 'suspended') {
    try {
      audioContext.resume();
    } catch {}
  }
}

// 2. LOGIC 1 CHẠM MỞ KHÓA TOÀN DIỆN (FULLSCREEN + BYPASS AUTOPLAY POLICY + KHÓA CỨNG MÀN HÌNH TV)
// Kích hoạt chế độ Toàn màn hình
function activateFullscreen() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch((err) => console.warn('Fullscreen request failed:', err));
    } else if ((el as any).webkitRequestFullscreen) {
      (el as any).webkitRequestFullscreen();
    } else if ((el as any).msRequestFullscreen) {
      (el as any).msRequestFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen activation error:', err);
  }
}

// Mở khóa hệ thống Audio (Bypass Autoplay Policy)
function unlockAudioSystem() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      if (!audioContext) {
        audioContext = new AudioCtx();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      // Khởi tạo dummy AudioContext và resume() để trình duyệt cấp phép phát âm thanh vĩnh viễn cho trang
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0.0001; // Âm lượng cực nhỏ để đánh thức audio subsystem mà không gây tiếng ồn
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.02);
      console.log('🔊 AudioContext dummy oscillator completed. Audio playback unlocked permanently.');
    }
  } catch (err) {
    console.warn('AudioContext bypass error:', err);
  }

  // Nếu player YouTube đã sẵn sàng: Gọi player.unMute(); player.setVolume(100);
  if (isPlayerReady && player) {
    try {
      if (typeof player.unMute === 'function') {
        player.unMute();
      }
      if (typeof player.setVolume === 'function') {
        player.setVolume(100);
      }
      console.log('🔊 YouTube Player unmuted and volume set to 100 on TV start');
    } catch (err) {
      console.warn('Cannot unmute YouTube player on unlock:', err);
    }
  }
}

// Hàm thực thi khi người dùng chạm hoặc click nút "BẮT ĐẦU PHÒNG HÁT (FULLSCREEN & MỞ ÂM THANH)"
function handleTvStart() {
  if (isTvActivated) return;
  isTvActivated = true;
  hasUserInteracted = true;
  console.log('🎤 [TV Host] Clicked "BẮT ĐẦU PHÒNG HÁT": Activating Fullscreen + Unlocking Audio System + Hard-locking TV Screen');

  // 1. Kích hoạt Toàn màn hình
  activateFullscreen();

  // 2. Mở khóa hệ thống Audio (Bypass Autoplay Policy)
  unlockAudioSystem();

  // 3. Ẩn hoàn toàn nút bấm này đi
  if (tvActivationOverlay) {
    tvActivationOverlay.classList.add('opacity-0', 'pointer-events-none');
    setTimeout(() => {
      tvActivationOverlay.classList.add('hidden');
    }, 400);
  }

  // 4. KHÓA CỨNG MÀN HÌNH TV: Thêm class 'pointer-events-none' và 'select-none' + ẩn con trỏ chuột
  document.body.classList.add('tv-kiosk-mode', 'pointer-events-none', 'select-none');
  document.body.style.pointerEvents = 'none';
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'none';

  const tvContainer = document.getElementById('tv-container');
  if (tvContainer) {
    tvContainer.classList.add('pointer-events-none', 'select-none');
    tvContainer.style.pointerEvents = 'none';
    tvContainer.style.userSelect = 'none';
    tvContainer.style.cursor = 'none';
  }

  // Bật tấm chắn vật lý screenBlocker (lớp z-[9999] trong suốt bao bọc toàn màn hình chặn triệt để mọi cú click/chạm)
  if (screenBlocker) {
    screenBlocker.classList.remove('hidden');
    screenBlocker.style.display = 'block';
    screenBlocker.style.pointerEvents = 'auto';
    screenBlocker.style.cursor = 'none';
  }

  // 5. Nếu đã có bài hát đang chờ trong hàng đợi, lập tức phát với âm thanh đầy đủ
  if (pendingVideoId && isPlayerReady && player) {
    console.log('▶️ Playing pending video immediately on TV activation:', pendingVideoId);
    playVideo(pendingVideoId);
    pendingVideoId = null;
  }
}

// 1. TỐI ƯU ĐỘ PHÂN GIẢI & ĐỘ LIỀN MẠCH (720p / ZERO-BUFFERING CHO KARAOKE)
function onPlayerPlaybackQualityChange(event: any) {
  console.log('📺 Playback quality changed to:', event.data);
  // Không ép 1080p/4K để tránh khựng hình (buffering) và đảm bảo bài hát tải gần như tức thì
  if (event.data === 'hd1080' || event.data === 'highres') {
    if (player && typeof player.setPlaybackQuality === 'function') {
      try {
        player.setPlaybackQuality('hd720');
        console.log('⚡ Capped resolution to hd720 for smooth zero-buffering karaoke');
      } catch (e) {
        console.warn('Cannot set playback quality:', e);
      }
    }
  }
}

// 1. CẤU HÌNH YOUTUBE IFRAME CLEAN TV VIEW (Ẩn toàn bộ nút điều khiển và gợi ý của YouTube)
window.onYouTubeIframeAPIReady = () => {
  if (player) return;
  player = new window.YT.Player('youtube-player', {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1,
      controls: 0,          // Ẩn thanh tua, tăng giảm âm lượng, nút phóng to của YouTube
      disablekb: 1,         // Tắt phím tắt bàn phím
      fs: 0,                // Ẩn nút toàn màn hình của YouTube
      modestbranding: 1,    // Ẩn logo YouTube
      rel: 0,               // Không gợi ý video ngoài
      iv_load_policy: 3,    // Tắt chú thích/thẻ bài hát đè lên video
      playsinline: 1,       // Phát trực tiếp trong trang
      enablejsapi: 1,
      origin: window.location.origin
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onPlaybackQualityChange: onPlayerPlaybackQualityChange,
      onError: onPlayerError
    }
  });
};

// Dự phòng nếu YouTube Iframe API script đã tải xong trước khi file script thực thi
if (window.YT && window.YT.Player && !player) {
  window.onYouTubeIframeAPIReady();
}

function onPlayerReady() {
  isPlayerReady = true;
  console.log('✅ YouTube IFrame Player is ready (Clean TV Mode)');
  // 1. Khóa mức trần chất lượng YouTube ở 720p (hd720) chống giật, mượt mà
  if (player && typeof player.setPlaybackQuality === 'function') {
    try {
      player.setPlaybackQuality('hd720');
      console.log('🔒 Locked playback quality to hd720 on player ready');
    } catch (e) {
      console.warn('Cannot set playback quality on ready:', e);
    }
  }
  // Tự động bật âm thanh
  autoUnmutePlayer();

  if (pendingVideoId) {
    playVideo(pendingVideoId);
    pendingVideoId = null;
  }
}

let lastPlaybackSyncTime = 0;

// 1. CHẶN ĐỨNG LƯỚI GỢI Ý VIDEO CỦA YOUTUBE Ở CUỐI BÀI (Chạy mỗi 200ms)
function startTimeTracker() {
  if (timeCheckInterval) clearInterval(timeCheckInterval);
  timeCheckInterval = setInterval(() => {
    if (isScoringActive) return;
    if (
      isPlayerReady &&
      player &&
      typeof player.getCurrentTime === 'function' &&
      typeof player.getDuration === 'function'
    ) {
      try {
        const duration = player.getDuration();
        const currentTime = player.getCurrentTime();

        // Đồng bộ thời gian phát cho các Màn hình TV phụ mỗi 4 giây (chỉ từ TV chính)
        if (isPrimaryHost && currentTime > 2 && Date.now() - lastPlaybackSyncTime > 4000) {
          lastPlaybackSyncTime = Date.now();
          socket.emit('sync_playback_time', { roomId: currentRoomId, currentTime });
        }

        // Kiểm tra điều kiện hợp lệ:
        // Tuyệt đối không ngắt khi duration = 0 hoặc currentTime = 0 (tránh lag mạng trả về rỗng làm dừng bài oan)
        // Chỉ bắt đầu kiểm tra khi bài hát đã chạy qua ít nhất 10 giây và duration hợp lệ (> 30s)
        if (!duration || duration <= 30 || currentTime < 10) return;

        // Chỉ ngắt video khi: (duration - currentTime) <= 2.5 và player đang ở trạng thái PLAYING (1)
        const isPlaying = typeof player.getPlayerState === 'function' ? player.getPlayerState() === 1 : true;
        if ((duration - currentTime) <= 2.5 && isPlaying) {
          console.log(`⏰ Video nearing end (${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s). Stopping video immediately & triggering scoring modal!`);
          triggerKaraokeScoring();
        }
      } catch (err) {
        console.warn('Error checking video end time:', err);
      }
    }
  }, 200); // Mỗi 200ms
}

function stopTimeTracker() {
  if (timeCheckInterval) {
    clearInterval(timeCheckInterval);
    timeCheckInterval = null;
  }
  clearPlaybackWatchdog();
}

// ÂM THANH CHÚC MỪNG & VỖ TAY GIÒN GIÃ QUA WEB AUDIO API (Không cần tải file ngoài, 100% tin cậy)
function playCelebrationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // 1. Nhạc chuông chúc mừng rộn ràng / Fanfare arpeggio (C5 -> E5 -> G5 -> C6)
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.14);

      gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.14);
      gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + idx * 0.14 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.85);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + idx * 0.14);
      osc.stop(ctx.currentTime + idx * 0.14 + 0.9);
    });

    // 2. Tiếng vỗ tay chúc mừng (Applause / Clapping effect)
    for (let i = 0; i < 10; i++) {
      const delay = 0.55 + i * 0.14 + Math.random() * 0.06;
      const bufferSize = Math.floor(ctx.sampleRate * 0.08);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        output[j] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1300 + Math.random() * 600;
      filter.Q.value = 2.2;

      const clapGain = ctx.createGain();
      clapGain.gain.setValueAtTime(0.2, ctx.currentTime + delay);
      clapGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.07);

      whiteNoise.connect(filter);
      filter.connect(clapGain);
      clapGain.connect(ctx.destination);

      whiteNoise.start(ctx.currentTime + delay);
      whiteNoise.stop(ctx.currentTime + delay + 0.08);
    }
  } catch (err) {
    console.warn('Cannot play celebration sound:', err);
  }
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

// 1. HẾT BÀI / CHUYỂN BÀI: DỪNG VIDEO, HIỆN BẢNG CHẤM ĐIỂM (5 GIÂY) RỒI MỚI CHUYỂN BÀI
function triggerKaraokeScoring(settledData?: any) {
  if (isScoringActive) return;
  isScoringActive = true;
  stopTimeTracker();

  // Lập tức gọi player.stopVideo() và ẩn/xóa hiển thị thẻ iframe
  if (player && typeof player.stopVideo === 'function') {
    try {
      player.stopVideo();
    } catch {
      // ignore
    }
  }

  // Ẩn hoàn toàn khung video để YouTube tuyệt đối không thể vẽ lưới gợi ý
  if (playerContainer) {
    playerContainer.style.opacity = '0';
    playerContainer.style.visibility = 'hidden';
  }

  if (settledData) {
    displayScoringModal(settledData);
  } else {
    // Gọi server chốt sổ điểm số chính xác dựa trên đóng góp hợp lệ của khán giả
    socket.emit('settle_song_score', { roomId: currentRoomId }, (res: any) => {
      displayScoringModal(res);
    });
  }
}

function displayScoringModal(data?: any) {
  const leadSinger = (data && (data.leadSinger || data.singer)) || (currentSongData ? (currentSongData.userName || 'Khách') : 'Khách');
  const songTitle = (data && data.songTitle) || (currentSongData ? currentSongData.title : 'Bài hát vừa rồi');
  const wasPresentDuringSong = Boolean(
    data
      ? (data.wasPresentDuringSong ?? data.wasOnlineAtStart ?? (data.isLeadOnline !== false))
      : true
  );
  const coSingers: string[] = (data && Array.isArray(data.coSingers)) ? data.coSingers : (currentCoSingers || []);
  const hasCoSingers = coSingers.length > 0;

  const defaultBaseScore = Math.floor(Math.random() * 16) + 65;
  const rawTotalScore = (data && typeof data.totalSongScore === 'number')
    ? data.totalSongScore
    : (data && typeof data.earnedScore === 'number')
    ? data.earnedScore
    : defaultBaseScore;

  // Điểm số trung tâm:
  // Nếu ca sĩ chính vắng mặt suốt cả bài hát và KHÔNG CÓ AI hát phụ -> 0 ĐIỂM
  const isAbsentAllSongNoCoSingers = !wasPresentDuringSong && !hasCoSingers;
  const totalScore = isAbsentAllSongNoCoSingers ? 0 : Math.min(100, Math.round(rawTotalScore));

  const leadSingerScore = (data && typeof data.leadSingerScore === 'number')
    ? data.leadSingerScore
    : (wasPresentDuringSong ? totalScore : 0);
  const coSingerScore = (data && typeof data.coSingerScore === 'number')
    ? data.coSingerScore
    : Math.round(totalScore * 0.5);

  // 1. Tên bài hát: Hiển thị 1 dòng nhỏ gọn bên dưới vòng tròn điểm
  if (scoreSongTitleEl) {
    scoreSongTitleEl.textContent = songTitle;
  }

  // 2. Dòng nhận xét ngẫu nhiên tương ứng với thang điểm thực tế
  if (scoreCommentEl) {
    const commentText = (data && typeof data.comment === 'string' && data.comment.trim())
      ? data.comment.trim()
      : getKaraokeScoreComment(totalScore, isAbsentAllSongNoCoSingers || totalScore === 0);
    scoreCommentEl.textContent = commentText;
    scoreCommentEl.classList.remove('hidden');
  }

  // 2. Khung chi tiết tổng kết (TỐI GIẢN - ĐỦ Ý):
  // BỐ CỤC 2 CỘT TÁCH BIỆT: Trái (flex-1) VAI TRÒ & TÊN NGƯỜI - Phải (shrink-0) ĐIỂM SỐ & CHI TIẾT
  if (scoreBreakdownListEl) {
    scoreBreakdownListEl.innerHTML = '';

    if (wasPresentDuringSong) {
      // TRƯỜNG HỢP 1: Ca sĩ có mặt trong lúc bài hát diễn ra (dù bắt đầu hay vào lại giữa chừng):
      const baseScore = (data && typeof data.baseScore === 'number') ? data.baseScore : totalScore;
      const interactionBonus = (data && typeof data.interactionBonus === 'number') ? data.interactionBonus : 0;
      
      let detailBonusText = '';
      if (baseScore + interactionBonus >= 100) {
        // Nếu tổng điểm gốc + quà VƯỢT QUÁ hoặc BẰNG 100:
        detailBonusText = `(${baseScore} gốc + ${interactionBonus} quà - max 100)`;
      } else if (interactionBonus > 0) {
        // Nếu tổng điểm CHƯA ĐẠT 100 và có quà:
        detailBonusText = `(${baseScore} gốc + ${interactionBonus} quà)`;
      }

      // Hàng ca sĩ chính
      const leadRow = document.createElement('div');
      leadRow.className = 'flex justify-between items-start w-full gap-4 py-1.5';
      leadRow.innerHTML = `
        <div class="flex-1 min-w-0 text-left">
          <span class="text-neutral-400 font-normal mr-1.5">Ca sĩ chính:</span>
          <span class="font-bold text-white whitespace-normal break-words">${escapeHtml(leadSinger)}</span>
        </div>
        <div class="shrink-0 text-right whitespace-nowrap self-start">
          <div class="font-black text-amber-400 text-base leading-tight">+${leadSingerScore}đ</div>
          ${detailBonusText ? `<div class="text-[11px] text-neutral-400 font-normal leading-tight mt-0.5">${detailBonusText}</div>` : ''}
        </div>
      `;
      scoreBreakdownListEl.appendChild(leadRow);

      // Hàng hát phụ (nếu có)
      if (hasCoSingers) {
        const coRow = document.createElement('div');
        coRow.className = 'flex justify-between items-start w-full gap-4 py-1.5 border-t border-neutral-800/80 pt-2 mt-1';
        coRow.innerHTML = `
          <div class="flex-1 min-w-0 text-left">
            <span class="text-neutral-400 font-normal mr-1.5">Hát phụ:</span>
            <span class="font-bold text-white whitespace-normal break-words">${escapeHtml(coSingers.join(', '))}</span>
          </div>
          <div class="shrink-0 text-right whitespace-nowrap self-start">
            <div class="font-black text-emerald-400 text-base leading-tight">+${coSingerScore}đ</div>
            <div class="text-[11px] text-emerald-300/80 font-normal leading-tight mt-0.5">(+50%)</div>
          </div>
        `;
        scoreBreakdownListEl.appendChild(coRow);
      }
    } else {
      // TRƯỜNG HỢP 2: Ca sĩ chính vắng mặt suốt cả bài hát (không online giây nào):
      if (hasCoSingers) {
        // Có người hát phụ gánh bài:
        const leadRow = document.createElement('div');
        leadRow.className = 'flex justify-between items-start w-full gap-4 py-1.5';
        leadRow.innerHTML = `
          <div class="flex-1 min-w-0 text-left">
            <span class="text-neutral-400 font-normal mr-1.5">Ca sĩ chính:</span>
            <span class="font-bold text-neutral-300 whitespace-normal break-words">${escapeHtml(leadSinger)} <span class="text-red-400 font-semibold">(vắng mặt cả bài)</span></span>
          </div>
          <div class="shrink-0 text-right whitespace-nowrap self-start">
            <div class="font-black text-neutral-400 text-base leading-tight">0đ</div>
          </div>
        `;
        scoreBreakdownListEl.appendChild(leadRow);

        const coRow = document.createElement('div');
        coRow.className = 'flex justify-between items-start w-full gap-4 py-1.5 border-t border-neutral-800/80 pt-2 mt-1';
        coRow.innerHTML = `
          <div class="flex-1 min-w-0 text-left">
            <span class="text-neutral-400 font-normal mr-1.5">Hát phụ:</span>
            <span class="font-bold text-white whitespace-normal break-words">${escapeHtml(coSingers.join(', '))}</span>
          </div>
          <div class="shrink-0 text-right whitespace-nowrap self-start">
            <div class="font-black text-emerald-400 text-base leading-tight">+${coSingerScore}đ</div>
            <div class="text-[11px] text-emerald-300/80 font-normal leading-tight mt-0.5">(+50%)</div>
          </div>
        `;
        scoreBreakdownListEl.appendChild(coRow);
      } else {
        // KHÔNG CÓ AI hát phụ:
        const emptyRow = document.createElement('div');
        emptyRow.className = 'text-center py-2 text-neutral-300';
        emptyRow.innerHTML = `
          <div class="text-sm font-bold text-white mb-1">
            Ca sĩ chính: <span class="text-neutral-300">${escapeHtml(leadSinger)}</span> <span class="text-red-400 font-semibold">(off)</span>
          </div>
          <div class="text-xs text-red-400 font-medium bg-red-500/10 border border-red-500/20 rounded-lg py-1 px-3 inline-block">
            Vắng mặt suốt bài hát → Chấm 0đ (không cộng điểm BXH)
          </div>
        `;
        scoreBreakdownListEl.appendChild(emptyRow);
      }
    }
  }

  // Vòng tròn trung tâm (#score-number)
  animateScoreNumber(totalScore);

  // Phát âm thanh vỗ tay chúc mừng qua loa TV (nếu có điểm)
  if (totalScore > 0) {
    playCelebrationSound();
  }

  // Hiện Popup Chấm điểm Karaoke (#score-modal)
  if (karaokeScoreOverlay) {
    karaokeScoreOverlay.classList.remove('hidden');
  }

  // 3. Đồng hồ đếm ngược: 1 dòng nhỏ gọn "Bài tiếp theo sau Xs..."
  let countdown = 7;
  if (scoreCountdownNumEl) scoreCountdownNumEl.textContent = '7';
  if (scoreCountdownTextEl) {
    scoreCountdownTextEl.innerHTML = 'Bài tiếp theo sau <span id="score-countdown-num" class="text-amber-400 font-bold">7</span>s...';
  }

  if (scoreCountdownInterval) clearInterval(scoreCountdownInterval);
  scoreCountdownInterval = setInterval(() => {
    countdown -= 1;
    const countEl = document.getElementById('score-countdown-num');
    if (countEl) countEl.textContent = String(countdown);

    if (countdown <= 0) {
      clearInterval(scoreCountdownInterval);
      scoreCountdownInterval = null;

      const checkHasNext = latestQueue && latestQueue.length > 0;
      if (checkHasNext) {
        console.log('⏱️ Đã hết 7 giây chấm điểm. Tự động nạp bài tiếp theo...');
        finishScoringAndPlayNext();
      } else {
        console.log('⏱️ Đã hết 7 giây chấm điểm nhưng hàng đợi rỗng.');
        isScoringActive = false;
        isWaitingForNextSongWithScore = true;
        socket.emit('song_ended', { roomId: currentRoomId });
      }
    }
  }, 1000);
}

function animateScoreNumber(targetScore: number) {
  if (!scoreNumberEl) return;
  scoreNumberEl.textContent = '0';
  if (targetScore <= 0) {
    scoreNumberEl.textContent = '0';
    return;
  }
  let currentVal = 0;
  const stepTime = Math.max(15, Math.floor(800 / targetScore));
  const stepAmount = Math.ceil(targetScore / 30);
  const timer = setInterval(() => {
    currentVal += stepAmount;
    if (currentVal >= targetScore) {
      currentVal = targetScore;
      clearInterval(timer);
    }
    if (scoreNumberEl) {
      scoreNumberEl.textContent = String(currentVal);
    }
  }, stepTime);
}

function finishScoringAndPlayNext() {
  if (scoreCountdownInterval) {
    clearInterval(scoreCountdownInterval);
    scoreCountdownInterval = null;
  }
  if (karaokeScoreOverlay) {
    karaokeScoreOverlay.classList.add('hidden');
  }
  isScoringActive = false;
  isWaitingForNextSongWithScore = false;
  updateTVInteractionBadge(0);

  // Khôi phục hiển thị player container khi phát bài tiếp theo
  if (playerContainer) {
    playerContainer.style.opacity = '1';
    playerContainer.style.visibility = 'visible';
  }

  console.log('🎬 Score countdown finished. Playing next song in queue...');
  socket.emit('song_ended', { roomId: currentRoomId });
}

function onPlayerStateChange(event: any) {
  // YT.PlayerState.ENDED is 0
  if (event.data === 0) {
    clearPlaybackWatchdog();
    console.log('🎬 YouTube Video ENDED -> Triggering Karaoke Score');
    if (!isScoringActive) {
      triggerKaraokeScoring();
    }
  } else if (event.data === 1) { // YT.PlayerState.PLAYING (1)
    clearPlaybackWatchdog();
    console.log('▶️ Video is playing in Clean TV Mode (720p Zero-Buffering)');
    // Khóa mức trần chất lượng YouTube ở 720p (hd720) để đảm bảo không tự động nhảy lên 1080p hay 4K gây giật lag
    if (player && typeof player.setPlaybackQuality === 'function') {
      try {
        player.setPlaybackQuality('hd720');
        console.log('🔒 Capped playback quality to hd720 on PLAYING');
      } catch (err) {
        console.warn('Cannot set playback quality to hd720 on playing:', err);
      }
    }
    startTimeTracker();
    // Tự động bật âm thanh nếu chưa bật
    autoUnmutePlayer();
  } else if (event.data === 2) { // YT.PlayerState.PAUSED (2)
    // Nếu không phải do hệ thống chủ động gọi kết thúc bài, lập tức gọi player.playVideo() để video tiếp tục chạy mượt mà
    if (!isScoringActive && player && typeof player.playVideo === 'function') {
      console.log('⚠️ Video paused unexpectedly -> Resuming playback immediately with player.playVideo()');
      try {
        player.playVideo();
      } catch (err) {
        console.warn('Cannot resume paused video:', err);
      }
    }
  } else if (event.data === 3) { // YT.PlayerState.BUFFERING (3)
    console.log('⏳ Video is buffering naturally -> Keeping stream open, no interruption');
    // Cho phép player tải tiếp tự nhiên, KHÔNG can thiệp gọi lệnh stop hay trigger chấm điểm
  }
}

let isHandlingErrorSkip = false;

// Bắt sự kiện lỗi onError: Tuyệt đối KHÔNG kết thúc bài hát bình thường và KHÔNG cộng/chấm điểm oan
function onPlayerError(event: any) {
  clearPlaybackWatchdog();
  console.warn('⚠️ YouTube Player error code:', event.data);

  // 1. Dừng ngay bộ đếm thời gian kiểm tra cuối bài
  stopTimeTracker();

  // 2. Tuyệt đối không gọi triggerKaraokeScoring, tắt ngay modal điểm nếu đang mở
  isScoringActive = false;
  isWaitingForNextSongWithScore = false;
  if (karaokeScoreOverlay) {
    karaokeScoreOverlay.classList.add('hidden');
  }
  if (scoreCountdownInterval) {
    clearInterval(scoreCountdownInterval);
    scoreCountdownInterval = null;
  }

  // 3. Thông báo lỗi rõ ràng theo từng mã lỗi
  let errorMsg = 'Video không thể phát, đang chuyển bài kế tiếp...';
  if (event.data === 101 || event.data === 150) {
    errorMsg = 'Video không cho phép nhúng, đang chuyển bài kế tiếp...';
  } else if (event.data === 2) {
    errorMsg = 'Video ID không hợp lệ, đang chuyển bài kế tiếp...';
  } else if (event.data === 5) {
    errorMsg = 'Lỗi phát HTML5 video, đang chuyển bài kế tiếp...';
  }
  showToast(errorMsg, 4000);

  // 4. Sau 3 giây tự động skip sang bài tiếp theo trong queue mà KHÔNG tính điểm bài lỗi
  if (errorSkipTimeout) clearTimeout(errorSkipTimeout);
  isHandlingErrorSkip = true;

  errorSkipTimeout = setTimeout(() => {
    console.log('⏭️ Auto-skipping unplayable/blocked video after 3s without scoring');
    socket.emit('skip_error_song', { roomId: currentRoomId, videoId: currentPlayingId });
    socket.emit('skip_song', { roomId: currentRoomId, noScore: true });
    isHandlingErrorSkip = false;
  }, 3000);
}

// ==========================================
// WATCHDOG TIMER BẢO VỆ PLAYER KHÔNG BỊ ĐƠ:
// 1. Sau 6 giây nếu video vẫn kẹt ở UNSTARTED (-1) hoặc BUFFERING (3):
//    -> Tự động player.mute() và player.playVideo() để vượt cơ chế chặn autoplay của trình duyệt.
// 2. Nếu sau thêm 4 giây (tổng cộng 10s) vẫn không thể phát:
//    -> Tự động thông báo nhẹ nhàng và skip sang bài tiếp theo trong hàng đợi mà không làm treo hệ thống.
// ==========================================
let watchdogPhase1Timer: ReturnType<typeof setTimeout> | null = null;
let watchdogPhase2Timer: ReturnType<typeof setTimeout> | null = null;

function clearPlaybackWatchdog() {
  if (watchdogPhase1Timer) {
    clearTimeout(watchdogPhase1Timer);
    watchdogPhase1Timer = null;
  }
  if (watchdogPhase2Timer) {
    clearTimeout(watchdogPhase2Timer);
    watchdogPhase2Timer = null;
  }
}

function startPlaybackWatchdog(videoId: string) {
  clearPlaybackWatchdog();

  // Giai đoạn 1: Sau 6s nếu video vẫn kẹt ở UNSTARTED (-1) hoặc BUFFERING (3)
  watchdogPhase1Timer = setTimeout(() => {
    watchdogPhase1Timer = null;
    if (!player || !isPlayerReady) return;

    let state = -1;
    try {
      state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
    } catch {
      state = -1;
    }

    if (state === -1 || state === 3) {
      console.warn(`⚠️ [Watchdog 6s] Video ${videoId} đang kẹt ở state ${state}. Tự động player.mute() và player.playVideo() để vượt chặn autoplay.`);
      try {
        if (typeof player.mute === 'function') player.mute();
        if (typeof player.playVideo === 'function') player.playVideo();
      } catch (err) {
        console.warn('Watchdog mute/play error:', err);
      }
      showUnmuteBanner();

      // Giai đoạn 2: Cho thêm 4s (tổng cộng 10s). Nếu vẫn không thể phát -> skip sang bài tiếp theo
      watchdogPhase2Timer = setTimeout(() => {
        watchdogPhase2Timer = null;
        if (!player || !isPlayerReady) return;

        let state2 = -1;
        try {
          state2 = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
        } catch {
          state2 = -1;
        }

        if (state2 === -1 || state2 === 3 || state2 === 2) {
          console.warn(`⚠️ [Watchdog 10s] Video ${videoId} không thể phát sau 10s (state ${state2}). Tự động skip bài tiếp theo.`);
          showToast('⚠️ Video không thể tải (lỗi mạng hoặc chặn nhúng), đang chuyển bài kế tiếp...', 3500);

          socket.emit('skip_error_song', { roomId: currentRoomId, videoId: currentPlayingId });
          socket.emit('skip_song', { roomId: currentRoomId, noScore: true });
        }
      }, 4000);
    }
  }, 6000);
}

// Kiểm tra và xử lý lỗi Autoplay bị trình duyệt chặn
function handleAutoplayPolicyFallback() {
  if (!player || !isPlayerReady) return;
  try {
    const isMuted = typeof player.isMuted === 'function' && player.isMuted();
    const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
    if (state === 2 || isMuted) {
      console.warn('🔇 Autoplay blocked with sound -> Muting to force video playback');
      try {
        if (typeof player.mute === 'function') player.mute();
        if (typeof player.playVideo === 'function') player.playVideo();
      } catch (err) {
        console.warn('Cannot force muted play:', err);
      }
      showUnmuteBanner();
    } else if (state === 1 && !isMuted) {
      hideUnmuteBanner();
    }
  } catch (err) {
    console.warn('Autoplay fallback error:', err);
  }
}

// Phát video
function playVideo(videoId: string) {
  if (!videoId) return;

  // Bảo vệ Player TV: Nếu videoId không đổi và player đang phát mượt mà, tuyệt đối không reload
  if (isPlayerReady && player && currentPlayingId === videoId) {
    try {
      const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
      if (state === 1 || state === 3) {
        console.log(`🎬 Video ${videoId} is already playing smoothly. Ignoring duplicate playVideo.`);
        return;
      }
    } catch {}
  }

  currentPlayingId = videoId;
  isHandlingErrorSkip = false;
  clearPlaybackWatchdog();
  if (errorSkipTimeout) {
    clearTimeout(errorSkipTimeout);
    errorSkipTimeout = null;
  }

  // Đảm bảo playerContainer hiển thị rõ ràng khi bắt đầu bài hát mới
  if (playerContainer) {
    playerContainer.style.opacity = '1';
    playerContainer.style.visibility = 'visible';
  }

  // Tắt bảng điểm nếu còn hiển thị
  if (karaokeScoreOverlay) {
    karaokeScoreOverlay.classList.add('hidden');
  }
  if (scoreCountdownInterval) {
    clearInterval(scoreCountdownInterval);
    scoreCountdownInterval = null;
  }
  isScoringActive = false;
  isWaitingForNextSongWithScore = false;

  if (!isPlayerReady || !player) {
    pendingVideoId = videoId;
    return;
  }

  try {
    // Thử mở âm thanh ban đầu
    try {
      if (typeof player.unMute === 'function') {
        player.unMute();
        player.setVolume(100);
      }
    } catch (e) {
      console.warn('Cannot unmute player initially:', e);
    }

    // Tối ưu 720p / Zero-buffering: gợi ý hd720 khi tải video
    player.loadVideoById({
      videoId: videoId,
      startSeconds: 0,
      suggestedQuality: 'hd720'
    });

    if (typeof player.setPlaybackQuality === 'function') {
      try {
        player.setPlaybackQuality('hd720');
      } catch {
        try { player.setPlaybackQuality('large'); } catch {}
      }
    }

    const playResult = player.playVideo();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch((err: any) => {
        console.warn('⚠️ Autoplay unmuted blocked by browser policy -> Falling back to muted playback:', err);
        try {
          if (typeof player.mute === 'function') player.mute();
          if (typeof player.playVideo === 'function') player.playVideo();
        } catch {}
        showUnmuteBanner();
      });
    }

    // Khởi chạy Watchdog Timer kiểm tra trạng thái video
    startPlaybackWatchdog(videoId);

    // Kiểm tra lại sau 800ms để đảm bảo phát tiếng nếu trình duyệt cho phép, hoặc hiện nút Unmute
    setTimeout(() => {
      handleAutoplayPolicyFallback();
    }, 800);
  } catch (err) {
    console.error('Error loading video:', err);
  }
}

// 2. CẬP NHẬT THANH CON NHỘNG THÔNG TIN BÀI HÁT (Top Song Pill) & TRẠNG THÁI GIAO DIỆN
function updateUIState(state: SyncStateData) {
  const { currentSong, queue } = state;
  latestQueue = queue || [];
  if (currentSong) {
    currentSongData = currentSong;
  }

  if (currentSong) {
    // Ẩn màn hình chờ khi có bài hát đang phát
    idleScreen.classList.add('hidden');

    // Tự động tắt Bảng Chấm Điểm nếu đang hiển thị
    if (karaokeScoreOverlay) {
      karaokeScoreOverlay.classList.add('hidden');
    }
    if (scoreCountdownInterval) {
      clearInterval(scoreCountdownInterval);
      scoreCountdownInterval = null;
    }
    isScoringActive = false;
    isWaitingForNextSongWithScore = false;

    if (playerContainer) {
      playerContainer.style.opacity = '1';
      playerContainer.style.visibility = 'visible';
    }

    if (topSongPill) {
      topSongPill.classList.remove('hidden');
    }

    // Cập nhật thông tin bài hát trên Top Song Pill dạng một dòng liền mạch (Single Capsule Marquee)
    const currentTitle = currentSong.title || `Video #${currentSong.videoId}`;
    const singerName = (currentSong.userName || (currentSong as any).requester || 'Khách').trim();
    const singerBadgeHtml = isCurrentSingerOnline
      ? `<span class="inline-flex items-center text-xs text-[#f1f1f1] font-semibold bg-white/10 px-2 py-0.5 rounded-full"><span class="mr-1 text-red-500">🎤</span>${escapeHtml(singerName)}</span>`
      : `<span class="inline-flex items-center text-xs text-amber-300 font-bold bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 rounded-full animate-pulse"><span class="mr-1">🎤</span>${escapeHtml(singerName)} (off)</span>`;

    const coSingersHtml = currentCoSingers && currentCoSingers.length > 0
      ? `<span class="inline-flex items-center text-xs text-red-300 font-semibold bg-red-950/50 border border-red-500/40 px-2 py-0.5 rounded-full"><span class="mr-1">👥 Hát cùng:</span>${escapeHtml(currentCoSingers.join(', '))}</span>`
      : '';

    if (queue && queue.length > 0) {
      const nextTitle = queue[0].title || 'Bài tiếp theo';
      renderTopSongPill(`
        <span class="inline-flex items-center font-black text-white drop-shadow-sm">
          <span class="mr-1.5 text-red-500">🎵</span>
          <span>${escapeHtml(currentTitle)}</span>
        </span>
        <span class="mx-2 text-white/35 font-bold select-none">•</span>
        ${singerBadgeHtml}
        ${coSingersHtml ? `<span class="mx-2 text-white/35 font-bold select-none">•</span>${coSingersHtml}` : ''}
        <span class="mx-3 text-white/35 font-bold select-none">•</span>
        <span class="inline-flex items-center font-bold text-amber-300 drop-shadow-sm">
          <span class="mr-1 text-amber-400">⚡ Tiếp:</span>
          <span class="text-amber-200 font-semibold">${escapeHtml(nextTitle)}</span>
        </span>
      `);
    } else {
      renderTopSongPill(`
        <span class="inline-flex items-center font-black text-white drop-shadow-sm">
          <span class="mr-1.5 text-rose-400">🎵</span>
          <span>${escapeHtml(currentTitle)}</span>
        </span>
        <span class="mx-2 text-white/35 font-bold select-none">•</span>
        ${singerBadgeHtml}
        ${coSingersHtml ? `<span class="mx-2 text-white/35 font-bold select-none">•</span>${coSingersHtml}` : ''}
        <span class="mx-3 text-white/35 font-bold select-none">•</span>
        <span class="inline-flex items-center font-medium text-amber-300/90 text-xs sm:text-[13px] italic bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full select-none">
          (Đây là bài hát cuối)
        </span>
      `);
    }

    // Nếu bài mới khác bài đang phát và không trong lúc chấm điểm
    if (currentPlayingId !== currentSong.videoId && !isScoringActive) {
      playVideo(currentSong.videoId);
    }
  } else {
    // Idle state: Chưa có bài hát nào trong hàng đợi
    currentPlayingId = null;
    stopTimeTracker();
    updateTVInteractionBadge(0);

    // NẾU ĐANG TRONG 5S CHẤM ĐIỂM HOẶC ĐANG CHỜ BÀI MỚI VỚI BẢNG ĐIỂM:
    // TUYỆT ĐỐI KHÔNG ĐỂ MÀN HÌNH CHỜ ĐÈ LÊN HOẶC TẮT BẢNG ĐIỂM
    if (isScoringActive || isWaitingForNextSongWithScore) {
      idleScreen.classList.add('hidden');
      if (karaokeScoreOverlay) {
        karaokeScoreOverlay.classList.remove('hidden');
      }
    } else {
      idleScreen.classList.remove('hidden');
      if (karaokeScoreOverlay) {
        karaokeScoreOverlay.classList.add('hidden');
      }
      isScoringActive = false;
    }

    if (playerContainer) {
      playerContainer.style.opacity = '1';
      playerContainer.style.visibility = 'visible';
    }

    if (topSongPill) {
      topSongPill.classList.remove('hidden');
    }

    renderTopSongPill(`
      <span class="inline-flex items-center text-neutral-300 font-medium text-xs sm:text-sm">
        <span class="mr-1.5 text-neutral-400">🎵</span>
        <span>Đang chờ bài hát...</span>
      </span>
    `);

    if (isPlayerReady && player) {
      try {
        player.stopVideo();
      } catch {
        // ignore
      }
    }
  }
}

// Đăng ký TV Host (Hỗ trợ Màn hình chính & Màn hình TV phụ qua mã PIN 4 số của phòng)
function registerAsHost() {
  const pinToSend = currentTvPin || localStorage.getItem('karaoke_tv_pin') || '';
  console.log('📡 Registering TV Host for room:', currentRoomId, 'PIN:', pinToSend ? '****' : '(none)');
  socket.emit('register_host', {
    roomId: currentRoomId,
    hostToken,
    pin: pinToSend
  }, (res: any) => {
    handleHostRegisterResponse(res);
  });
}

function handleHostRegisterResponse(res: any) {
  if (!res) return;
  if (!res.success) {
    console.warn('⛔ TV Host registration denied:', res.error || res.message);
    const msg = res.message || (res.error === 'INVALID_PIN'
      ? 'Mã PIN không đúng. Vui lòng nhập 4 số PIN đang hiển thị trên màn hình TV chính:'
      : 'Phòng đã có TV chính phát. Vui lòng nhập mã PIN trên TV chính để kết nối TV phụ:');
    showTvPinModal(msg);
    return;
  }

  // Kết nối thành công
  hideTvPinModal();
  if (res.isSecondary) {
    isSecondaryHost = true;
    isPrimaryHost = false;
    if (res.pin) {
      currentTvPin = res.pin;
      localStorage.setItem('karaoke_tv_pin', res.pin);
    }
    console.log('📺 Joined as Secondary TV Host (Multi-Screen Mode)');
    showToast('📺 Đã kết nối Màn hình TV phụ thành công!', 3000);
  } else {
    isPrimaryHost = true;
    isSecondaryHost = false;
    console.log('📺 Registered as Primary TV Host');
  }
}

// Socket events
socket.on('connect', () => {
  console.log('⚡ Connected to Karaoke Server as Host for room:', currentRoomId);
  registerAsHost();
  autoUnmutePlayer();
});

socket.on('room_host_exists', (data: { roomId?: string; message?: string }) => {
  const msg = data?.message || 'Phòng đã có màn hình TV chính. Vui lòng nhập mã PIN 4 số trên TV chính để kết nối TV phụ:';
  console.warn('⚠️ Room host exists event:', msg);
  showTvPinModal(msg);
});

socket.on('unauthorized_host', (data: { message?: string }) => {
  const msg = data?.message || 'Mã PIN không chính xác. Vui lòng kiểm tra lại 4 số PIN trên màn hình TV chính!';
  console.warn('⛔ Unauthorized host:', msg);
  showTvPinModal(msg);
});

socket.on('host_ready', (data: { roomId: string; pin: string; isSecondary?: boolean; isPrimary?: boolean }) => {
  console.log('📺 Host ready event received. PIN:', data.pin, 'for room:', data.roomId, 'isSecondary:', !!data.isSecondary);
  hideTvPinModal();
  if (data.isSecondary) {
    isSecondaryHost = true;
    isPrimaryHost = false;
    if (data.pin) {
      currentTvPin = data.pin;
      localStorage.setItem('karaoke_tv_pin', data.pin);
    }
    showToast('📺 Màn hình TV phụ đã sẵn sàng đồng bộ!', 2500);
  } else {
    isPrimaryHost = true;
    isSecondaryHost = false;
  }
  localStorage.setItem('karaoke_tv_room', data.roomId);
  updateTvQrAndPin(data.roomId, data.pin);
});

// Đồng bộ Tạm dừng / Tiếp tục giữa các TV Host
socket.on('pause_video', () => {
  console.log('⏸️ Sync: Pause video received from server');
  if (isPlayerReady && player && typeof player.pauseVideo === 'function') {
    try {
      player.pauseVideo();
    } catch {}
  }
});

socket.on('resume_video', () => {
  console.log('▶️ Sync: Resume video received from server');
  if (isPlayerReady && player && typeof player.playVideo === 'function') {
    try {
      player.playVideo();
    } catch {}
  }
});

socket.on('sync_playback_time', (data: { currentTime: number }) => {
  // Chỉ TV phụ mới cần đồng bộ tiến độ thời gian theo TV chính nếu lệch quá 1.8 giây
  if (!isPrimaryHost && isPlayerReady && player && typeof player.getCurrentTime === 'function') {
    try {
      const current = player.getCurrentTime();
      if (Math.abs(current - data.currentTime) > 1.8) {
        console.log(`🔄 Syncing video time from primary TV (${current.toFixed(1)}s -> ${data.currentTime.toFixed(1)}s)`);
        player.seekTo(data.currentTime, true);
      }
    } catch (err) {
      console.warn('Sync playback error:', err);
    }
  }
});

socket.on('remote_unmute', () => {
  console.log('⚡ Received remote_unmute signal from client device');
  autoUnmutePlayer();
});

socket.on('sync_state', (state: SyncStateData) => {
  currentCoSingers = state.coSingers || [];
  if (state.isSingerOnline !== undefined) {
    isCurrentSingerOnline = state.isSingerOnline;
  }
  if (state.interactions) {
    updateTVInteractionBadge(state.interactions.totalPoints || 0);
  }
  updateUIState(state);
  renderMembers(latestMembersList);
});

socket.on('singer_connection_changed', (data: { isOnline: boolean; singerName: string }) => {
  isCurrentSingerOnline = data.isOnline;
  renderMembers(latestMembersList);
  if (currentSongData) {
    updateUIState({
      currentSong: currentSongData,
      queue: latestQueue,
      totalWaiting: latestQueue.length,
      interactions: { totalPoints: currentSongInteractionPoints, hearts: 0, flowers: 0, cheers: 0, claps: 0, crowns: 0, rockets: 0, comments: 0 },
      coSingers: currentCoSingers,
      isSingerOnline: data.isOnline
    });
  }
  if (!data.isOnline && data.singerName) {
    showToast(`⚠️ Ca sĩ ${data.singerName} đang mất kết nối!`, 3500);
  } else if (data.isOnline && data.singerName) {
    showToast(`🟢 Ca sĩ ${data.singerName} đã kết nối lại!`, 3000);
  }
});

socket.on('queue_updated', (updatedQueue: SongItem[]) => {
  latestQueue = updatedQueue || [];
  updateUIState({
    currentSong: currentSongData,
    queue: latestQueue,
    totalWaiting: latestQueue.length,
    interactions: { totalPoints: currentSongInteractionPoints, hearts: 0, flowers: 0, cheers: 0, claps: 0, crowns: 0, rockets: 0, comments: 0 },
    coSingers: currentCoSingers
  });
});

socket.on('co_singers_updated', (data: { coSingers: string[] }) => {
  currentCoSingers = data.coSingers || [];
  renderMembers(latestMembersList);
});

socket.on('update_members', (membersList: RoomMember[]) => {
  renderMembers(membersList || []);
  if (membersList && membersList.length > 0) {
    autoUnmutePlayer();
  }
});

socket.on('member_joined', (data: { name: string }) => {
  if (data && data.name) {
    showMemberJoinToast(data.name);
    autoUnmutePlayer();
  }
});

// Xử lý chuyển bài sớm (Skip / Qua bài từ điện thoại): DỪNG VIDEO -> BẬT BẢNG ĐIỂM 5S CHO NGƯỜI VỪA HÁT -> SAU ĐÓ MỚI PHÁT TIẾP
function handleSkipRequest(data?: any) {
  console.log('⏭️ Received skip/next request from phone client');
  if (isHandlingErrorSkip) {
    console.log('⏭️ Error skip already pending, skipping duplicate skip request');
    return;
  }
  if (data?.noScore) {
    if (isPlayerReady && player && typeof player.stopVideo === 'function') {
      try {
        player.stopVideo();
      } catch {}
    }
    return;
  }
  if (isScoringActive) {
    // Nếu đang trong lúc chấm điểm rồi mà người dùng bấm qua bài tiếp -> chuyển bài ngay
    finishScoringAndPlayNext();
  } else if (currentSongData) {
    console.log('🎬 Early skip: Stopping video & triggering 5-second scoring for current singer');
    triggerKaraokeScoring(data);
  } else {
    socket.emit('song_ended', { roomId: currentRoomId });
  }
}

socket.on('request_skip', handleSkipRequest);
socket.on('skip_song', handleSkipRequest);
socket.on('next_song', handleSkipRequest);
socket.on('song_score_settled', (data: any) => {
  if (isScoringActive && data) {
    displayScoringModal(data);
  }
});

socket.on('play_song', (song: SongItem) => {
  console.log('🎵 Now playing song:', song.title);
  // Khi có bài hát mới từ điện thoại: Tự động tắt bảng chấm điểm và phát bài mới ngay lập tức
  if (karaokeScoreOverlay) {
    karaokeScoreOverlay.classList.add('hidden');
  }
  if (scoreCountdownInterval) {
    clearInterval(scoreCountdownInterval);
    scoreCountdownInterval = null;
  }
  isScoringActive = false;
  isWaitingForNextSongWithScore = false;

  updateUIState({
    currentSong: song,
    queue: latestQueue,
    totalWaiting: latestQueue.length
  });
  updateTVInteractionBadge(0);
  if (currentPlayingId !== song.videoId) {
    playVideo(song.videoId);
  }
});

socket.on('new_reaction', (data: any) => {
  if (data && data.interactions) {
    updateTVInteractionBadge(data.interactions.totalPoints);
  } else if (data && typeof data.points === 'number') {
    updateTVInteractionBadge(currentSongInteractionPoints + data.points);
  }

  if (data && data.type === 'comment' && data.text) {
    spawnDanmakuComment(data.text, data.userName || 'Bạn bè');
  } else if (data && data.type === 'rocket') {
    spawnRocketBlast(data.userName || 'Bạn bè');
  } else if (data && ['heart', 'flower', 'cheers', 'clap', 'crown'].includes(data.type)) {
    spawnFloatingReaction(data.type, data.userName || 'Bạn bè');
  }
});

socket.on('stop_song', () => {
  console.log('⏹️ No more songs in queue.');
  // Nếu đang trong lúc chấm điểm hoặc vừa chấm điểm xong (chờ bài mới), không tắt bảng điểm
  if (!isScoringActive && !isWaitingForNextSongWithScore) {
    updateUIState({
      currentSong: null,
      queue: [],
      totalWaiting: 0
    });
  }
});

// Lắng nghe sự kiện kích hoạt nút Bắt Đầu Phòng Hát (1 chạm)
if (btnStartTv) {
  btnStartTv.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTvStart();
  });
  btnStartTv.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleTvStart();
  });
}

if (tvActivationOverlay) {
  tvActivationOverlay.addEventListener('click', () => {
    handleTvStart();
  });
}

// KHÓA 100% THAO TÁC TRỰC TIẾP TRÊN MÀN HÌNH TV (DISPLAY-ONLY KIOSK MODE)
if (screenBlocker) {
  const blockEvent = (e: Event) => {
    // Nếu banner unmute đang hiển thị hoặc player đang bị mute, chạm vào màn hình sẽ kích hoạt mở tiếng
    const unmuteBanner = document.getElementById('unmute-banner');
    if (unmuteBanner && !unmuteBanner.classList.contains('hidden')) {
      autoUnmutePlayer();
    }
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
  ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu', 'dblclick', 'pointerdown'].forEach((evt) => {
    screenBlocker.addEventListener(evt, blockEvent, { capture: true, passive: false });
  });
}

// Chặn toàn bộ phím bấm trên TV (chỉ cho phép F11 toàn màn hình, hoặc phím Enter/Space/Play để kích hoạt nếu chưa bắt đầu)
window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') return;
  if (!isTvActivated && (e.key === 'Enter' || e.key === ' ' || e.key === 'MediaPlayPause')) {
    handleTvStart();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}, { capture: true, passive: false });

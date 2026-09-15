import { RoomMember, SearchResultItem, SongItem, SyncStateData } from './types';

declare global {
  interface Window {
    io: any;
  }
}

declare const io: any;

// User & Room state
const clientUrlParams = new URLSearchParams(window.location.search);
let clientRoomId = (clientUrlParams.get('room') || '').trim() || (localStorage.getItem('karaoke_client_room') || '').trim();
let clientPin = (clientUrlParams.get('pin') || '').trim() || (localStorage.getItem('karaoke_client_pin') || '').trim() || (sessionStorage.getItem('karaoke_client_pin') || '').trim();

// Hàm helper cập nhật thanh địa chỉ URL luôn hiển thị ?room=[tên_phòng] minh bạch
function updateBrowserUrlRoom(roomId: string) {
  if (!roomId || !roomId.trim()) return;
  try {
    const currentParams = new URLSearchParams(window.location.search);
    if (currentParams.get('room') !== roomId) {
      currentParams.set('room', roomId);
      const newQuery = currentParams.toString();
      const newUrl = newQuery ? `${window.location.pathname}?${newQuery}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
    document.title = `Remote Chọn Bài - Phòng ${roomId}`;
  } catch (e) {
    console.warn('Cannot update room in browser URL:', e);
  }
}

// Nếu đã có tên phòng từ URL hoặc localStorage thì lưu và cập nhật URL ngay
if (clientRoomId) {
  localStorage.setItem('karaoke_client_room', clientRoomId);
  updateBrowserUrlRoom(clientRoomId);
}
if (clientPin) {
  localStorage.setItem('karaoke_client_pin', clientPin);
  sessionStorage.setItem('karaoke_client_pin', clientPin);
}

// Sinh và lưu userId cố định trên thiết bị này để tự động reconnect
let currentUserId = localStorage.getItem('karaoke_user_id') || '';
if (!currentUserId) {
  currentUserId = 'uid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  localStorage.setItem('karaoke_user_id', currentUserId);
}

let hasJoinedRoomInSession = sessionStorage.getItem('karaoke_session_joined') === 'true';
let currentUserName = localStorage.getItem('karaoke_username') || '';

// Join Room Modal Elements
const joinRoomModal = document.getElementById('join-room-modal') as HTMLElement;
const joinRoomForm = document.getElementById('join-room-form') as HTMLFormElement;
const joinRoomGroup = document.getElementById('join-room-group') as HTMLElement;
const joinRoomInput = document.getElementById('join-room-input') as HTMLInputElement;
const roomBadgeAuto = document.getElementById('room-badge-auto') as HTMLElement;
const joinNameInput = document.getElementById('join-name-input') as HTMLInputElement;
const joinPinGroup = document.getElementById('join-pin-group') as HTMLElement;
const joinPinInput = document.getElementById('join-pin-input') as HTMLInputElement;
const pinBadgeAuto = document.getElementById('pin-badge-auto') as HTMLElement;
const joinErrorMsg = document.getElementById('join-error-msg') as HTMLElement;
const joinModalSubtext = document.getElementById('join-modal-subtext') as HTMLElement;

// Socket connection (tự động nhận diện host và port từ trình duyệt)
const socket = typeof io === 'function' ? io() : window.io();

// DOM Elements
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const clearSearchBtn = document.getElementById('clear-search-btn') as HTMLButtonElement;
const doSearchBtn = document.getElementById('do-search-btn') as HTMLButtonElement;
const searchLoadingEl = document.getElementById('search-loading') as HTMLElement;
const searchEmptyEl = document.getElementById('search-empty') as HTMLElement;
const resultsListEl = document.getElementById('results-list') as HTMLElement;
const searchSectionTitle = document.getElementById('search-section-title') as HTMLElement;
const resultsCountBadge = document.getElementById('results-count-badge') as HTMLElement;

// Header & Connection
const connectionDotEl = document.getElementById('connection-dot') as HTMLElement;
const connectionStatusEl = (document.getElementById('connection-text') || document.getElementById('connection-status')) as HTMLElement;
const userProfileBtn = document.getElementById('user-profile-btn') as HTMLButtonElement;
const headerUsernameDisplay = document.getElementById('header-username-display') as HTMLElement;

// Mini Bar (Collapsible Now Playing & Queue indicator)
const nowPlayingMiniBar = document.getElementById('now-playing-mini-bar') as HTMLElement;
const miniBarThumb = document.getElementById('mini-bar-thumb') as HTMLImageElement;
const miniBarIdleIcon = document.getElementById('mini-bar-idle-icon') as HTMLElement;
const miniBarLiveDot = document.getElementById('mini-bar-live-dot') as HTMLElement;
const miniBarBadge = document.getElementById('mini-bar-badge') as HTMLElement;
const miniBarTitle = document.getElementById('mini-bar-title') as HTMLElement;
const miniBarSubtitle = document.getElementById('mini-bar-subtitle') as HTMLElement;
const miniBarQueueCount = document.getElementById('mini-bar-queue-count') as HTMLElement;
const openQueueBtn = document.getElementById('open-queue-btn') as HTMLButtonElement;

// Queue Modal / Drawer
const queueModal = document.getElementById('queue-modal') as HTMLElement;
const queueModalPanel = document.getElementById('queue-modal-panel') as HTMLElement;
const closeQueueModalBtn = document.getElementById('close-queue-modal-btn') as HTMLButtonElement;
const modalQueueCount = document.getElementById('modal-queue-count') as HTMLElement;
const modalNowPlayingBox = document.getElementById('modal-now-playing-box') as HTMLElement;
const modalNowThumb = document.getElementById('modal-now-thumb') as HTMLImageElement;
const modalNowTitle = document.getElementById('modal-now-title') as HTMLElement;
const modalNowRequester = document.getElementById('modal-now-requester') as HTMLElement;
const modalSkipBtn = document.getElementById('modal-skip-btn') as HTMLButtonElement;
const modalQueueEmpty = document.getElementById('modal-queue-empty') as HTMLElement;
const modalQueueItems = (document.getElementById('modal-queue-items') || document.getElementById('queue-items')) as HTMLElement;

// Action Sheet Elements for Queued Song Options
const queueActionSheet = document.getElementById('queue-action-sheet') as HTMLElement;
const queueActionSheetPanel = document.getElementById('queue-action-sheet-panel') as HTMLElement;
const sheetSongThumb = document.getElementById('sheet-song-thumb') as HTMLImageElement;
const sheetSongTitle = document.getElementById('sheet-song-title') as HTMLElement;
const sheetSongRequester = document.getElementById('sheet-song-requester') as HTMLElement;
const sheetCloseBtnTop = document.getElementById('sheet-close-btn-top') as HTMLButtonElement;
const sheetBtnPriority = document.getElementById('sheet-btn-priority') as HTMLButtonElement;
const sheetBtnMoveUp = document.getElementById('sheet-btn-move-up') as HTMLButtonElement;
const sheetBtnMoveDown = document.getElementById('sheet-btn-move-down') as HTMLButtonElement;
const sheetBtnDelete = document.getElementById('sheet-btn-delete') as HTMLButtonElement;
const sheetBtnCancel = document.getElementById('sheet-btn-cancel') as HTMLButtonElement;
let selectedQueueSong: SongItem | null = null;

// Username Modal
const usernameModal = document.getElementById('username-modal') as HTMLElement;
const usernameModalInput = document.getElementById('username-modal-input') as HTMLInputElement;
const closeUsernameModalBtn = document.getElementById('close-username-modal-btn') as HTMLButtonElement;
const cancelUsernameBtn = document.getElementById('cancel-username-btn') as HTMLButtonElement;
const saveUsernameBtn = document.getElementById('save-username-btn') as HTMLButtonElement;

// Toast
const toastEl = document.getElementById('toast') as HTMLElement;
const toastIcon = document.getElementById('toast-icon') as HTMLElement;
const toastText = document.getElementById('toast-text') as HTMLElement;
let toastTimeout: any = null;

// 2 TABS DOM Elements
const tabBtnSongs = document.getElementById('tab-btn-songs') as HTMLButtonElement;
const tabBtnReactions = document.getElementById('tab-btn-reactions') as HTMLButtonElement;
const tabContentSongs = document.getElementById('tab-content-songs') as HTMLElement;
const tabContentReactions = document.getElementById('tab-content-reactions') as HTMLElement;

// Tab Tương tác DOM Elements
const reactionTotalPointsDisplay = document.getElementById('reaction-total-points-display') as HTMLElement;
const reactionCommentForm = document.getElementById('reaction-comment-form') as HTMLFormElement;
const reactionCommentInput = document.getElementById('reaction-comment-input') as HTMLInputElement;
const commentCharCount = document.getElementById('comment-char-count') as HTMLElement;
const recentReactionsFeed = document.getElementById('recent-reactions-feed') as HTMLElement;
const reactionsFeedEmpty = document.getElementById('reactions-feed-empty') as HTMLElement;
const searchInitialPrompt = document.getElementById('search-initial-prompt') as HTMLElement;
const myScoreEl = document.getElementById('my-score') as HTMLElement;
const myContributedScoreEl = document.getElementById('my-contributed-score') as HTMLElement;
const contributedBadgeBox = document.getElementById('contributed-badge-box') as HTMLElement;
const singingActionBar = document.getElementById('singing-action-bar') as HTMLElement;
const joinSingingBtn = document.getElementById('join-singing-btn') as HTMLButtonElement;
const reactionsControlsContainer = document.getElementById('reactions-controls-container') as HTMLElement;

// Search cache
const localSearchCache = new Map<string, SearchResultItem[]>();
let currentSearchQuery = '';
let searchDebounceTimer: any = null;
let currentAppSyncState: SyncStateData | null = null;
let myContributedScore = 0;
let lastPlayingSongId: string | null = null;
let isCurrentUserSinging = false;
let isCurrentSingerOnline = true;
let latestRoomMembers: RoomMember[] = [];

// Leaderboard Modal Elements
const openLeaderboardBtn = document.getElementById('open-leaderboard-btn') as HTMLButtonElement | null;
const leaderboardModal = document.getElementById('leaderboard-modal') as HTMLElement | null;
const closeLeaderboardBtn = document.getElementById('close-leaderboard-btn') as HTMLButtonElement | null;
const leaderboardListEl = document.getElementById('leaderboard-list') as HTMLElement | null;

// Lấy tên người dùng hiện tại an toàn, đồng bộ từ state, localStorage và header
function getEffectiveUserName(): string {
  if (currentUserName && currentUserName.trim()) return currentUserName.trim();
  const stored = localStorage.getItem('karaoke_username');
  if (stored && stored.trim()) {
    currentUserName = stored.trim();
    return currentUserName;
  }
  const headerName = headerUsernameDisplay?.textContent?.trim();
  if (headerName && headerName !== 'Khách' && headerName !== 'Đổi tên') {
    currentUserName = headerName;
    return currentUserName;
  }
  return currentUserName || '';
}

// Initialize User Name
function updateUserNameDisplay() {
  if (headerUsernameDisplay) {
    headerUsernameDisplay.textContent = getEffectiveUserName() || 'Khách';
  }
}
updateUserNameDisplay();

// 3. TOAST NOTIFICATION
function showToast(message: string, type: 'success' | 'priority' | 'error' | 'info' = 'success') {
  if (!toastEl || !toastText || !toastIcon) return;
  if (toastTimeout) clearTimeout(toastTimeout);

  toastText.textContent = message;

  let bgClass = 'bg-neutral-900 text-white border border-neutral-700';
  let icon = '✓';

  if (type === 'success') {
    bgClass = 'bg-emerald-950/95 text-emerald-200 border border-emerald-700/80 shadow-emerald-950/50';
    icon = '✓';
  } else if (type === 'priority') {
    bgClass = 'bg-amber-950/95 text-amber-200 border border-amber-600/80 shadow-amber-950/50';
    icon = '⚡';
  } else if (type === 'error') {
    bgClass = 'bg-rose-950/95 text-rose-200 border border-rose-700/80 shadow-rose-950/50';
    icon = '✕';
  } else if (type === 'info') {
    bgClass = 'bg-[#212121]/95 text-[#f1f1f1] border border-[#3f3f3f] shadow-2xl';
    icon = 'ℹ';
  }

  toastIcon.textContent = icon;
  toastEl.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-full shadow-2xl text-xs sm:text-sm font-semibold flex items-center gap-2 max-w-[92vw] transition-all duration-200 ${bgClass}`;
  toastEl.classList.remove('hidden');

  toastTimeout = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3200);
}

// 1. TRẠNG THÁI BAN ĐẦU KHI CHƯA NHẬP TỪ KHÓA TÌM KIẾM
function showInitialSearchPrompt() {
  currentSearchQuery = '';
  if (searchLoadingEl) searchLoadingEl.classList.add('hidden');
  if (searchEmptyEl) searchEmptyEl.classList.add('hidden');
  if (resultsListEl) resultsListEl.innerHTML = '';
  if (resultsCountBadge) resultsCountBadge.textContent = 'Chưa tìm';
  if (searchSectionTitle) searchSectionTitle.innerHTML = '<span>Danh sách bài hát</span>';
  if (searchInitialPrompt) searchInitialPrompt.classList.remove('hidden');
}

// 1. TÌM KIẾM BÀI HÁT YOUTUBE TRỰC TIẾP
async function performSearch(query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    showInitialSearchPrompt();
    return;
  }

  if (searchInitialPrompt) searchInitialPrompt.classList.add('hidden');
  currentSearchQuery = trimmed;
  searchLoadingEl.classList.remove('hidden');
  searchEmptyEl.classList.add('hidden');
  resultsListEl.innerHTML = '';
  if (resultsCountBadge) resultsCountBadge.textContent = 'Đang tìm...';
  if (searchSectionTitle) searchSectionTitle.innerHTML = `<span>Kết quả cho: "${escapeHtml(trimmed)}"</span>`;

  // Check client-side memory cache
  const cacheKey = trimmed.toLowerCase();
  if (localSearchCache.has(cacheKey)) {
    const cachedResults = localSearchCache.get(cacheKey)!;
    renderSearchResults(cachedResults);
    searchLoadingEl.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
    if (!res.ok) throw new Error('Không thể tìm kiếm bài hát lúc này');
    const data = await res.json();
    const results: SearchResultItem[] = data.results || [];

    // Save to cache
    localSearchCache.set(cacheKey, results);

    // Only render if query hasn't changed in the meantime
    if (currentSearchQuery === trimmed) {
      renderSearchResults(results);
    }
  } catch (err: any) {
    console.error('Search error:', err);
    if (currentSearchQuery === trimmed) {
      searchLoadingEl.classList.add('hidden');
      searchEmptyEl.classList.remove('hidden');
      if (resultsCountBadge) resultsCountBadge.textContent = '0 bài';
    }
  } finally {
    if (currentSearchQuery === trimmed) {
      searchLoadingEl.classList.add('hidden');
    }
  }
}

// 2. GIAO DIỆN DANH SÁCH BÀI HÁT (GIỐNG ĐẦU MÁY KARAOKE)
function renderSearchResults(results: SearchResultItem[]) {
  resultsListEl.innerHTML = '';

  if (results.length === 0) {
    searchEmptyEl.classList.remove('hidden');
    if (resultsCountBadge) resultsCountBadge.textContent = '0 bài';
    return;
  }

  searchEmptyEl.classList.add('hidden');
  if (resultsCountBadge) resultsCountBadge.textContent = `${results.length} bài karaoke`;

  results.forEach((item, index) => {
    const card = document.createElement('div');
    card.className =
      'song-item-card bg-[#212121] hover:bg-[#272727] border border-[#3f3f3f] rounded-2xl p-3 transition shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 group';

    // Format views if available
    let viewText = '';
    if (item.views) {
      const v = typeof item.views === 'number' ? item.views : parseInt(String(item.views), 10);
      if (!isNaN(v) && v > 0) {
        viewText = v >= 1000000 ? ` • ${(v / 1000000).toFixed(1)}M lượt xem` : ` • ${(v / 1000).toFixed(0)}k lượt xem`;
      }
    }

    card.innerHTML = `
      <!-- Bên trái: Ảnh thumbnail & Thông tin bài hát -->
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <!-- Thumbnail -->
        <div class="relative w-24 h-16 sm:w-28 sm:h-18 rounded-xl overflow-hidden bg-[#121212] shrink-0 border border-[#3f3f3f]/60 shadow-sm">
          <img
            src="${escapeHtml(item.thumbnail)}"
            alt="${escapeHtml(item.title)}"
            class="w-full h-full object-cover transition duration-300 group-hover:scale-105"
            loading="lazy"
            onerror="this.src='https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg'"
          />
          ${
            item.duration
              ? `<span class="absolute bottom-1 right-1 bg-black/85 text-[#f1f1f1] text-[10px] font-semibold px-1.5 py-0.5 rounded">${escapeHtml(
                  item.duration
                )}</span>`
              : ''
          }
          <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-lg">
            ▶
          </div>
        </div>

        <!-- Tên bài hát in đậm, tên kênh/ca sĩ bên dưới -->
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-bold text-[#f1f1f1] line-clamp-2 leading-snug group-hover:text-red-400 transition" title="${escapeHtml(
            item.title
          )}">
            ${escapeHtml(item.title)}
          </h3>
          <p class="text-xs text-[#aaaaaa] mt-1 truncate flex items-center gap-1">
            <span class="text-red-500">🎤</span>
            <span class="text-[#f1f1f1] font-medium">${escapeHtml(item.channelTitle || 'Karaoke Beat')}</span>
            <span class="text-[#aaaaaa]">${viewText}</span>
          </p>
        </div>
      </div>

      <!-- Bên phải: 2 nút bấm thao tác nhanh [⚡ Ưu tiên] & [➕ Chọn bài] -->
      <div class="flex items-center gap-2 self-end sm:self-center shrink-0 w-full sm:w-auto justify-end pt-1 sm:pt-0 border-t border-[#3f3f3f] sm:border-0">
        <!-- Nút [⚡ Ưu tiên] -->
        <button
          type="button"
          data-action="priority"
          data-index="${index}"
          class="priority-btn flex-1 sm:flex-initial px-3.5 sm:px-4 py-2 rounded-full bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 hover:text-amber-200 border border-amber-500/30 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-amber-500/10"
          title="Đưa bài lên đầu danh sách chờ để phát ngay sau bài hiện tại"
        >
          <span>⚡</span>
          <span>Ưu tiên</span>
        </button>

        <!-- Nút [➕ Chọn bài] -->
        <button
          type="button"
          data-action="normal"
          data-index="${index}"
          class="pick-btn flex-1 sm:flex-initial px-4 sm:px-4.5 py-2 rounded-full bg-[#ff0000] hover:bg-[#cc0000] active:scale-95 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-red-600/30"
          title="Thêm bài này vào cuối hàng đợi"
        >
          <span>➕</span>
          <span>Chọn bài</span>
        </button>
      </div>
    `;

    // Attach Event Listeners to the buttons
    const priorityBtn = card.querySelector<HTMLButtonElement>('.priority-btn');
    const pickBtn = card.querySelector<HTMLButtonElement>('.pick-btn');

    if (priorityBtn) {
      priorityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSelectSong(item, true, priorityBtn);
      });
    }

    if (pickBtn) {
      pickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSelectSong(item, false, pickBtn);
      });
    }

    resultsListEl.appendChild(card);
  });
}

// Xử lý khi bấm Chọn bài hoặc Ưu tiên
function handleSelectSong(song: SearchResultItem, isPriority: boolean, buttonEl: HTMLButtonElement) {
  // Visual button feedback
  const originalHtml = buttonEl.innerHTML;
  buttonEl.disabled = true;

  if (isPriority) {
    buttonEl.innerHTML = `<span>⚡</span><span>Đã ưu tiên!</span>`;
    buttonEl.classList.add('bg-amber-500/40', 'text-amber-100');
  } else {
    buttonEl.innerHTML = `<span>✓</span><span>Đã chọn!</span>`;
    buttonEl.classList.add('bg-emerald-600', 'text-white');
  }

  // Restore button state after 1.5s
  setTimeout(() => {
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalHtml;
    buttonEl.classList.remove('bg-amber-500/40', 'text-amber-100', 'bg-emerald-600');
  }, 1500);

  // Send add_song event via Socket.IO
  const resolvedName = getEffectiveUserName() || 'Khách';
  socket.emit('add_song', {
    roomId: clientRoomId,
    userName: resolvedName,
    requester: resolvedName,
    videoId: song.videoId,
    title: song.title,
    channelTitle: song.channelTitle,
    thumbnail: song.thumbnail,
    duration: song.duration,
    priority: isPriority
  });
  socket.emit('remote_unmute', { roomId: clientRoomId });

  // 3. TOAST THÔNG BÁO NHẸ
  if (isPriority) {
    showToast(`⚡ Đã ưu tiên bài "${song.title}" lên đầu hàng đợi!`, 'priority');
  } else {
    showToast(`Đã thêm "${song.title}" vào danh sách chờ!`, 'success');
  }
}

// 3. THANH THU GỌN HIỂN THỊ BÀI ĐANG PHÁT VÀ SỐ LƯỢNG BÀI CHỜ
// CẬP NHẬT GIAO DIỆN THEO PHÂN VAI (CA SĨ CHÍNH / HÁT CÙNG / KHÁN GIẢ)
function updateRoleUI(currentSong: SongItem | null, coSingers: string[] = []) {
  if (!currentSong) {
    if (singingActionBar) singingActionBar.classList.add('hidden');
    if (reactionsControlsContainer) reactionsControlsContainer.classList.remove('hidden');
    isCurrentUserSinging = false;
    return;
  }

  if (singingActionBar) singingActionBar.classList.remove('hidden');

  const userName = getEffectiveUserName().trim();
  // So khớp người dùng hiện tại với người chọn bài (hỗ trợ cả requester và userName)
  const songRequester = ((currentSong as any).requester || currentSong.userName || '').trim();
  const isMainSinger = Boolean(
    currentSong &&
    songRequester &&
    userName &&
    (songRequester.toLowerCase() === userName.toLowerCase())
  );

  const isCoSinger = Boolean(
    userName &&
    coSingers &&
    coSingers.some((cs) => cs && cs.trim().toLowerCase() === userName.toLowerCase())
  );

  if (isMainSinger) {
    // 1. Ca sĩ chính (chủ bài): BẮT BUỘC đổi nút [🎤 Hát cùng] thành nhãn cố định: "🎤 Đang hát (Chính)" (vô hiệu hóa click, không cho bấm)
    isCurrentUserSinging = true;
    if (joinSingingBtn) {
      joinSingingBtn.disabled = true;
      joinSingingBtn.className = 'px-4 py-1.5 rounded-full bg-red-950/70 border border-red-500/60 text-red-200 font-extrabold text-xs flex items-center gap-1.5 cursor-default pointer-events-none shrink-0 select-none shadow-sm';
      joinSingingBtn.innerHTML = '<span>🎤</span> <span>Đang hát (Chính)</span>';
    }
    // Ẩn hoàn toàn dàn nút tặng hoa/tim/quà và ô bình luận của người này
    if (reactionsControlsContainer) reactionsControlsContainer.classList.add('hidden');
  } else if (isCoSinger) {
    // 2. Ca sĩ phụ (đã tham gia hát cùng): Đổi nút thành nhãn cố định "🎤 Đang hát (Phụ)", vô hiệu hóa click
    isCurrentUserSinging = true;
    if (joinSingingBtn) {
      joinSingingBtn.disabled = true;
      joinSingingBtn.className = 'px-4 py-1.5 rounded-full bg-red-950/50 border border-red-500/40 text-red-300 font-extrabold text-xs flex items-center gap-1.5 cursor-default pointer-events-none shrink-0 select-none shadow-sm';
      joinSingingBtn.innerHTML = '<span>🎤</span> <span>Đang hát (Phụ)</span>';
    }
    // Ẩn hoàn toàn dàn nút tặng hoa/tim/quà và ô bình luận của người này
    if (reactionsControlsContainer) reactionsControlsContainer.classList.add('hidden');
  } else {
    // 3. Khán giả (KHÔNG PHẢI là ca sĩ chính VÀ CHƯA bấm tham gia): Hiện nút bấm [🎤 Hát cùng] và mở lại dàn nút tương tác
    isCurrentUserSinging = false;
    if (joinSingingBtn) {
      joinSingingBtn.disabled = false;
      joinSingingBtn.className = 'px-4 py-1.5 rounded-full bg-[#ff0000] hover:bg-[#cc0000] text-white font-extrabold text-xs shadow-md shadow-red-600/20 active:scale-95 transition flex items-center gap-1.5 cursor-pointer shrink-0';
      joinSingingBtn.innerHTML = '<span>🎤</span> <span id="join-singing-text">Hát cùng</span>';
    }
    if (reactionsControlsContainer) reactionsControlsContainer.classList.remove('hidden');
    updateGiftButtonsState();
  }
  updateInteractionLockState();
}

// Cập nhật nhãn trạng thái ca sĩ chính (Online vs Đang mất kết nối)
function updateSingerStatusBadges(hasSong: boolean, isOnline: boolean, singerName: string) {
  if (miniBarSubtitle) {
    if (!hasSong) {
      miniBarSubtitle.textContent = 'Hãy chọn bài từ danh sách bên dưới';
    } else if (!isOnline) {
      miniBarSubtitle.innerHTML = `🎤 Người gửi: <span class="font-semibold text-white">${escapeHtml(singerName)}</span> <span class="ml-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 rounded-full animate-pulse">⚠️ (off)</span>`;
    } else {
      miniBarSubtitle.innerHTML = `🎤 Người gửi: <span class="font-semibold text-white">${escapeHtml(singerName)}</span> <span class="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">🟢 Online</span>`;
    }
  }

  if (modalNowRequester) {
    if (!hasSong) {
      modalNowRequester.textContent = '';
    } else if (!isOnline) {
      modalNowRequester.innerHTML = `🎤 Ca sĩ: <span class="font-bold text-white">${escapeHtml(singerName)}</span> <span class="ml-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 rounded-full animate-pulse">⚠️ (off)</span>`;
    } else {
      modalNowRequester.innerHTML = `🎤 Ca sĩ: <span class="font-bold text-white">${escapeHtml(singerName)}</span> <span class="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">🟢 Online</span>`;
    }
  }
}

// Khóa hoặc mở tương tác (Tặng quà, Danmaku) khi ca sĩ mất kết nối hoặc không có bài
function updateInteractionLockState() {
  const currentSong = currentAppSyncState?.currentSong;
  const hasSong = Boolean(currentSong);
  const coSingers = currentAppSyncState?.coSingers || [];
  const hasCoSingers = coSingers.length > 0;
  // Khóa tương tác chỉ khi: Không có bài hát HOẶC (Ca sĩ chính Offline VÀ CHƯA CÓ AI hát cùng)
  const isLocked = !hasSong || (!isCurrentSingerOnline && !hasCoSingers);

  const quickBtns = document.querySelectorAll<HTMLButtonElement>('.reaction-quick-btn');
  const sendCommentBtn = document.getElementById('btn-send-comment') as HTMLButtonElement | null;
  const quickChips = document.querySelectorAll<HTMLButtonElement>('.quick-comment-chip');
  const disconnectAlert = document.getElementById('singer-disconnect-alert');
  const disconnectAlertText = document.getElementById('singer-disconnect-alert-text');
  const singerName = (currentSong?.userName || (currentSong as any)?.requester || '').trim();

  // 1. Quà tặng 4 nút (❤️, 🍻, 👑, 🚀)
  quickBtns.forEach((btn) => {
    if (isLocked) {
      btn.disabled = true;
      btn.classList.add('opacity-50', 'pointer-events-none');
    } else {
      btn.classList.remove('opacity-50', 'pointer-events-none');
    }
  });

  // 2. Ô nhập bình luận & nút Gửi
  if (reactionCommentInput) {
    if (!hasSong) {
      reactionCommentInput.disabled = true;
      reactionCommentInput.placeholder = 'Chưa có bài hát nào đang phát...';
      reactionCommentInput.classList.add('opacity-50', 'pointer-events-none');
    } else if (!isCurrentSingerOnline && !hasCoSingers) {
      reactionCommentInput.disabled = true;
      reactionCommentInput.placeholder = 'Ca sĩ chính Offline! Bấm "Hát cùng" để mở khóa tương tác...';
      reactionCommentInput.classList.add('opacity-50', 'pointer-events-none');
    } else if (!isCurrentSingerOnline && hasCoSingers) {
      reactionCommentInput.disabled = false;
      reactionCommentInput.placeholder = `Hát phụ (${coSingers[0]}) đang biểu diễn (+1 đ)...`;
      reactionCommentInput.classList.remove('opacity-50', 'pointer-events-none');
    } else {
      reactionCommentInput.disabled = false;
      reactionCommentInput.placeholder = 'Nhập bình luận (+1 đ)...';
      reactionCommentInput.classList.remove('opacity-50', 'pointer-events-none');
    }
  }

  if (sendCommentBtn) {
    if (isLocked) {
      sendCommentBtn.disabled = true;
      sendCommentBtn.classList.add('opacity-50', 'pointer-events-none');
    } else {
      sendCommentBtn.classList.remove('opacity-50', 'pointer-events-none');
    }
  }

  // 3. Các gợi ý bình luận nhanh
  quickChips.forEach((chip) => {
    if (isLocked) {
      chip.disabled = true;
      chip.classList.add('opacity-50', 'pointer-events-none');
    } else {
      chip.classList.remove('opacity-50', 'pointer-events-none');
    }
  });

  // 4. Banner cảnh báo mất kết nối
  if (disconnectAlert) {
    if (hasSong && !isCurrentSingerOnline) {
      disconnectAlert.classList.remove('hidden');
      if (disconnectAlertText) {
        if (!hasCoSingers) {
          disconnectAlertText.innerHTML = `⚠️ Ca sĩ chính <strong class="text-amber-300 font-bold">${escapeHtml(singerName || 'chính')}</strong> đang Offline! Bấm <strong class="text-red-400 underline font-bold cursor-pointer" onclick="document.getElementById('join-singing-btn')?.click()">[🎤 Hát cùng]</strong> để gánh bài và mở khóa tương tác (nhận 50% điểm thưởng)!`;
        } else {
          disconnectAlertText.innerHTML = `🎤 Ca sĩ chính Offline. <strong class="text-red-400 font-bold">${escapeHtml(coSingers.join(', '))}</strong> đang hát cùng! Đã mở khóa tương tác (Hát phụ nhận 50% điểm thưởng).`;
        }
      }
    } else {
      disconnectAlert.classList.add('hidden');
    }
  }

  // 5. Cập nhật nhãn trạng thái ca sĩ
  updateSingerStatusBadges(hasSong, isCurrentSingerOnline, singerName);

  // 6. Nếu mở khóa, áp dụng giới hạn điểm số của user
  if (!isLocked) {
    updateGiftButtonsState();
  }
}

function updateSyncState(state: SyncStateData) {
  currentAppSyncState = state;
  if (state.isSingerOnline !== undefined) {
    isCurrentSingerOnline = state.isSingerOnline;
  }
  const { currentSong, queue, totalWaiting, coSingers } = state;

  // Kiểm tra bài hát mới: Tự động reset điểm đã tặng my-contributed-score về 0
  const currentSongId = currentSong ? (currentSong.id || currentSong.videoId) : null;
  if (currentSongId !== lastPlayingSongId) {
    lastPlayingSongId = currentSongId;
    myContributedScore = 0;
    if (myContributedScoreEl) {
      myContributedScoreEl.textContent = '0';
    }
    updateGiftButtonsState();
  }

  // Cập nhật phân vai Ca sĩ / Hát cùng / Khán giả
  updateRoleUI(currentSong, coSingers || []);

  // Cập nhật số lượng bài chờ trên thanh thu gọn
  if (miniBarQueueCount) {
    miniBarQueueCount.textContent = String(totalWaiting);
  }
  if (modalQueueCount) {
    modalQueueCount.textContent = `${totalWaiting} bài`;
  }

  // Cập nhật thông tin bài đang phát
  const singerName = (currentSong?.userName || (currentSong as any)?.requester || '').trim();
  if (currentSong) {
    if (miniBarThumb) {
      miniBarThumb.src = currentSong.thumbnail || `https://img.youtube.com/vi/${currentSong.videoId}/mqdefault.jpg`;
      miniBarThumb.classList.remove('hidden');
    }
    if (miniBarIdleIcon) miniBarIdleIcon.classList.add('hidden');
    if (miniBarLiveDot) miniBarLiveDot.classList.remove('hidden');

    if (miniBarTitle) miniBarTitle.textContent = currentSong.title;

    // Update Modal Now Playing Box
    if (modalNowPlayingBox) modalNowPlayingBox.classList.remove('hidden');
    if (modalNowThumb) modalNowThumb.src = currentSong.thumbnail;
    if (modalNowTitle) modalNowTitle.textContent = currentSong.title;
  } else {
    if (miniBarThumb) miniBarThumb.classList.add('hidden');
    if (miniBarIdleIcon) miniBarIdleIcon.classList.remove('hidden');
    if (miniBarLiveDot) miniBarLiveDot.classList.add('hidden');

    if (miniBarTitle) miniBarTitle.textContent = 'TV đang chờ bài hát';

    if (modalNowPlayingBox) modalNowPlayingBox.classList.add('hidden');
  }

  updateSingerStatusBadges(Boolean(currentSong), isCurrentSingerOnline, singerName);
  updateInteractionLockState();

  // Render modal queue items
  renderModalQueue(queue);
}

// Open Action Sheet for Queued Song Options
function openQueueActionSheet(song: SongItem, index: number, totalCount: number) {
  if (!queueActionSheet || !queueActionSheetPanel) return;
  selectedQueueSong = song;

  if (sheetSongThumb) {
    sheetSongThumb.src = song.thumbnail || `https://img.youtube.com/vi/${song.videoId}/default.jpg`;
  }
  if (sheetSongTitle) {
    sheetSongTitle.textContent = song.title || song.videoId;
  }
  if (sheetSongRequester) {
    sheetSongRequester.textContent = `👤 Ca sĩ: ${song.userName}`;
  }

  // Cập nhật trạng thái nút Lên 1 bài (nếu đang ở vị trí 0 thì vô hiệu hóa)
  if (sheetBtnMoveUp) {
    if (index === 0) {
      sheetBtnMoveUp.disabled = true;
      sheetBtnMoveUp.classList.add('opacity-40', 'cursor-not-allowed');
      sheetBtnMoveUp.classList.remove('hover:bg-neutral-800', 'active:scale-[0.98]', 'cursor-pointer');
    } else {
      sheetBtnMoveUp.disabled = false;
      sheetBtnMoveUp.classList.remove('opacity-40', 'cursor-not-allowed');
      sheetBtnMoveUp.classList.add('hover:bg-neutral-800', 'active:scale-[0.98]', 'cursor-pointer');
    }
  }

  // Cập nhật trạng thái nút Xuống 1 bài (nếu đang ở vị trí cuối thì vô hiệu hóa)
  if (sheetBtnMoveDown) {
    if (index >= totalCount - 1) {
      sheetBtnMoveDown.disabled = true;
      sheetBtnMoveDown.classList.add('opacity-40', 'cursor-not-allowed');
      sheetBtnMoveDown.classList.remove('hover:bg-neutral-800', 'active:scale-[0.98]', 'cursor-pointer');
    } else {
      sheetBtnMoveDown.disabled = false;
      sheetBtnMoveDown.classList.remove('opacity-40', 'cursor-not-allowed');
      sheetBtnMoveDown.classList.add('hover:bg-neutral-800', 'active:scale-[0.98]', 'cursor-pointer');
    }
  }

  queueActionSheet.classList.remove('opacity-0', 'pointer-events-none');
  queueActionSheetPanel.classList.remove('translate-y-full');
}

function closeQueueActionSheet() {
  if (!queueActionSheet || !queueActionSheetPanel) return;
  queueActionSheet.classList.add('opacity-0', 'pointer-events-none');
  queueActionSheetPanel.classList.add('translate-y-full');
  selectedQueueSong = null;
}

function checkAndRefreshActionSheet(newQueue: SongItem[]) {
  if (!selectedQueueSong || !queueActionSheet || queueActionSheet.classList.contains('opacity-0')) {
    return;
  }
  const idx = newQueue.findIndex((s) => s.id === selectedQueueSong!.id);
  if (idx === -1) {
    closeQueueActionSheet();
  } else {
    openQueueActionSheet(newQueue[idx], idx, newQueue.length);
  }
}

// Render queue list inside modal drawer (Làm sạch hoàn toàn: Không có nút [✕], chạm vào mở Action Sheet)
function renderModalQueue(queue: SongItem[]) {
  if (!modalQueueItems || !modalQueueEmpty) return;

  modalQueueItems.innerHTML = '';
  if (!queue || queue.length === 0) {
    modalQueueEmpty.classList.remove('hidden');
    if (selectedQueueSong) {
      closeQueueActionSheet();
    }
    return;
  }

  modalQueueEmpty.classList.add('hidden');
  if (selectedQueueSong) {
    checkAndRefreshActionSheet(queue);
  }

  queue.forEach((song, idx) => {
    const item = document.createElement('div');
    item.className =
      'queue-item-row group flex items-center gap-3 p-2.5 rounded-xl bg-[#121212] hover:bg-[#272727] active:bg-[#383838] border border-[#3f3f3f] transition cursor-pointer select-none';
    item.setAttribute('data-id', song.id);
    item.setAttribute('title', 'Chạm vào để xem tùy chọn bài hát');

    const songUserTrimmed = (song.userName || '').trim().toLowerCase();
    const songMember = latestRoomMembers.find((m) => m.name.trim().toLowerCase() === songUserTrimmed);
    const isSongRequesterOffline = songMember ? songMember.isOnline === false : false;

    item.innerHTML = `
      <!-- Cột bên trái: Ô tròn STT (1, 2, 3...) hoặc icon [⚡] màu vàng nếu Ưu tiên -->
      <div class="w-6 h-6 rounded-full ${
        song.priority
          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
          : 'bg-[#272727] text-[#aaaaaa] group-hover:text-[#f1f1f1]'
      } text-xs font-bold flex items-center justify-center shrink-0">
        ${song.priority ? '⚡' : idx + 1}
      </div>

      <!-- Phần thân: Ảnh thumbnail + Tên bài hát + Tên người đặt (ca sĩ) -->
      <img
        src="${escapeHtml(song.thumbnail || `https://img.youtube.com/vi/${song.videoId}/default.jpg`)}"
        alt=""
        class="w-12 h-9 object-cover rounded-lg bg-[#272727] shrink-0 border border-[#3f3f3f]/60 group-hover:brightness-105 transition"
      />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold text-[#f1f1f1] group-hover:text-white truncate transition">
          ${escapeHtml(song.title || song.videoId)}
        </p>
        <p class="text-[11px] text-[#aaaaaa] truncate mt-0.5 flex items-center gap-1">
          <span>👤 ${escapeHtml(song.userName)}</span>
          ${isSongRequesterOffline ? '<span class="text-[9px] text-amber-300 font-bold bg-amber-500/20 border border-amber-500/30 px-1 rounded animate-pulse">(off)</span>' : ''}
        </p>
      </div>
    `;

    // Mở Action Sheet khi chạm vào bài hát
    item.addEventListener('click', () => {
      openQueueActionSheet(song, idx, queue.length);
    });

    modalQueueItems.appendChild(item);
  });
}

// Modal controls
function openQueueModal() {
  if (!queueModal || !queueModalPanel) return;
  queueModal.classList.remove('opacity-0', 'pointer-events-none');
  queueModalPanel.classList.remove('translate-y-full');
}

function closeQueueModal() {
  if (!queueModal || !queueModalPanel) return;
  queueModal.classList.add('opacity-0', 'pointer-events-none');
  queueModalPanel.classList.add('translate-y-full');
}

function openUsernameModal() {
  if (!usernameModal || !usernameModalInput) return;
  usernameModalInput.value = currentUserName === 'Khách' ? '' : currentUserName;
  usernameModal.classList.remove('opacity-0', 'pointer-events-none');
  setTimeout(() => usernameModalInput.focus(), 100);
}

function closeUsernameModal() {
  if (!usernameModal) return;
  usernameModal.classList.add('opacity-0', 'pointer-events-none');
}

// Search input handling & 3. Nút xóa nhanh (dấu x)
function updateClearButtonVisibility() {
  if (!clearSearchBtn || !searchInput) return;
  if (searchInput.value.trim().length > 0) {
    clearSearchBtn.classList.remove('hidden');
    clearSearchBtn.classList.add('flex');
  } else {
    clearSearchBtn.classList.add('hidden');
    clearSearchBtn.classList.remove('flex');
  }
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    updateClearButtonVisibility();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

    const query = searchInput.value.trim();
    if (query.length === 0) {
      showInitialSearchPrompt();
      return;
    }

    searchDebounceTimer = setTimeout(() => {
      performSearch(query);
    }, 380);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      performSearch(searchInput.value);
    }
  });
}

// 3. NÚT "XÓA NHANH" (DẤU X) TRONG Ô TÌM KIẾM
if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      updateClearButtonVisibility();
      searchInput.focus();
      showInitialSearchPrompt();
    }
  });
}

if (doSearchBtn) {
  doSearchBtn.addEventListener('click', () => {
    if (searchInput) {
      performSearch(searchInput.value);
    }
  });
}

// Quick genre/hot tag suggestions
document.querySelectorAll<HTMLButtonElement>('.hot-tag-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.query;
    if (q && searchInput) {
      searchInput.value = q;
      updateClearButtonVisibility();
      performSearch(q);
      window.scrollTo({ top: 120, behavior: 'smooth' });
    }
  });
});

// Mini bar click opens Queue Modal
if (nowPlayingMiniBar) {
  nowPlayingMiniBar.addEventListener('click', openQueueModal);
}
if (openQueueBtn) {
  openQueueBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openQueueModal();
  });
}

if (closeQueueModalBtn) {
  closeQueueModalBtn.addEventListener('click', closeQueueModal);
}

if (queueModal) {
  queueModal.addEventListener('click', (e) => {
    if (e.target === queueModal) closeQueueModal();
  });
}

if (modalSkipBtn) {
  modalSkipBtn.addEventListener('click', () => {
    socket.emit('skip_song', { roomId: clientRoomId });
    showToast('Đã gửi yêu cầu bỏ qua bài hát hiện tại', 'info');
  });
}

// 4. ACTION SHEET EVENT LISTENERS CHO BÀI HÁT TRONG HÀNG ĐỢI
if (sheetBtnPriority) {
  sheetBtnPriority.addEventListener('click', () => {
    if (!selectedQueueSong) return;
    const song = selectedQueueSong;
    socket.emit('prioritize_queue_song', { id: song.id, roomId: clientRoomId });
    showToast(`⚡ Đã ưu tiên bài "${song.title}" lên đầu hàng đợi`, 'success');
    closeQueueActionSheet();
  });
}

if (sheetBtnMoveUp) {
  sheetBtnMoveUp.addEventListener('click', () => {
    if (!selectedQueueSong) return;
    const song = selectedQueueSong;
    socket.emit('move_song_up', { id: song.id, roomId: clientRoomId });
    showToast(`▲ Đã chuyển bài "${song.title}" lên 1 vị trí`, 'info');
    closeQueueActionSheet();
  });
}

if (sheetBtnMoveDown) {
  sheetBtnMoveDown.addEventListener('click', () => {
    if (!selectedQueueSong) return;
    const song = selectedQueueSong;
    socket.emit('move_song_down', { id: song.id, roomId: clientRoomId });
    showToast(`▼ Đã chuyển bài "${song.title}" xuống 1 vị trí`, 'info');
    closeQueueActionSheet();
  });
}

if (sheetBtnDelete) {
  sheetBtnDelete.addEventListener('click', () => {
    if (!selectedQueueSong) return;
    const song = selectedQueueSong;
    socket.emit('remove_from_queue', { id: song.id, roomId: clientRoomId });
    socket.emit('remove_song', { id: song.id, roomId: clientRoomId });
    showToast(`🗑️ Đã xóa bài "${song.title}" khỏi hàng đợi`, 'info');
    closeQueueActionSheet();
  });
}

if (sheetBtnCancel) {
  sheetBtnCancel.addEventListener('click', closeQueueActionSheet);
}

if (sheetCloseBtnTop) {
  sheetCloseBtnTop.addEventListener('click', closeQueueActionSheet);
}

if (queueActionSheet) {
  queueActionSheet.addEventListener('click', (e) => {
    if (e.target === queueActionSheet) {
      closeQueueActionSheet();
    }
  });
}

// 2. LUỒNG XÁC THỰC MÃ PIN & THAM GIA PHÒNG HÁT (LƯU VÀ TÁI SỬ DỤNG USER_ID)
function attemptVerifyAndJoin(name: string, pin: string, roomToJoin?: string) {
  if (joinErrorMsg) joinErrorMsg.classList.add('hidden');

  const targetRoom = (roomToJoin || clientRoomId || '').trim();
  if (!targetRoom) {
    if (joinRoomModal) joinRoomModal.classList.remove('hidden');
    if (joinErrorMsg) {
      joinErrorMsg.textContent = 'Vui lòng nhập tên phòng Karaoke!';
      joinErrorMsg.classList.remove('hidden');
    }
    if (joinRoomInput) joinRoomInput.focus();
    return;
  }

  socket.emit('verify_and_join', { roomId: targetRoom, pin, name, userId: currentUserId }, (res: any) => {
    if (res && res.success) {
      currentUserName = name;
      clientPin = pin;
      clientRoomId = targetRoom;

      localStorage.setItem('karaoke_username', currentUserName);
      localStorage.setItem('karaoke_client_room', clientRoomId);
      localStorage.setItem('karaoke_client_pin', clientPin);
      sessionStorage.setItem('karaoke_client_pin', clientPin);
      sessionStorage.setItem('karaoke_session_joined', 'true');
      hasJoinedRoomInSession = true;

      // Cập nhật URL trình duyệt để luôn hiển thị ?room=[tên_phòng] minh bạch
      updateBrowserUrlRoom(clientRoomId);

      if (joinRoomModal) {
        joinRoomModal.classList.add('hidden');
      }
      updateUserNameDisplay();
      if (currentAppSyncState) {
        updateRoleUI(currentAppSyncState.currentSong, currentAppSyncState.coSingers || []);
      }
      showToast(`Chào mừng ${currentUserName} đã vào phòng [${clientRoomId}] 🎤`, 'success');
    } else {
      const message = res?.message || 'Mã PIN không đúng hoặc phòng không tồn tại. Vui lòng kiểm tra lại!';
      if (joinRoomModal) {
        joinRoomModal.classList.remove('hidden');
      }
      if (joinErrorMsg) {
        joinErrorMsg.textContent = message;
        joinErrorMsg.classList.remove('hidden');
      }
      if (joinPinInput) {
        joinPinInput.value = '';
        joinPinInput.focus();
      }
      if (pinBadgeAuto) {
        pinBadgeAuto.classList.add('hidden');
      }
      localStorage.removeItem('karaoke_client_pin');
      sessionStorage.removeItem('karaoke_client_pin');
      sessionStorage.removeItem('karaoke_session_joined');
      hasJoinedRoomInSession = false;
      clientPin = '';
    }
  });
}

async function initJoinRoomFlow() {
  const storedName = localStorage.getItem('karaoke_username')?.trim() || '';
  const storedPin = clientPin || localStorage.getItem('karaoke_client_pin') || '';
  if (storedPin) {
    clientPin = storedPin;
  }
  if (joinNameInput && storedName) {
    joinNameInput.value = storedName;
  }

  // Điền phòng nếu đã có
  if (clientRoomId && joinRoomInput) {
    joinRoomInput.value = clientRoomId;
    if (roomBadgeAuto) roomBadgeAuto.classList.remove('hidden');
    updateBrowserUrlRoom(clientRoomId);
  } else if (roomBadgeAuto) {
    roomBadgeAuto.classList.add('hidden');
  }

  if (clientPin && joinPinInput) {
    joinPinInput.value = clientPin;
    if (pinBadgeAuto) pinBadgeAuto.classList.remove('hidden');
  } else if (pinBadgeAuto) {
    pinBadgeAuto.classList.add('hidden');
  }

  // 1. Nếu đã có đầy đủ Tên, Tên phòng và PIN trong bộ nhớ:
  // Tự động dùng thông tin đó kết nối thẳng vào phòng và update URL
  if (storedName && clientPin && clientRoomId) {
    currentUserName = storedName;
    updateUserNameDisplay();
    updateBrowserUrlRoom(clientRoomId);
    if (joinRoomModal) {
      joinRoomModal.classList.add('hidden');
    }
    if (socket.connected) {
      attemptVerifyAndJoin(storedName, clientPin, clientRoomId);
    }
    return;
  }

  // 2. Nếu thiếu bất kỳ thông tin nào (Tên, PIN hoặc Tên phòng):
  // Hiện popup bắt buộc nhập thông tin để tham gia
  if (joinRoomModal) {
    joinRoomModal.classList.remove('hidden');

    if (clientRoomId && clientPin) {
      if (joinModalSubtext) {
        joinModalSubtext.textContent = `Đã nhận diện phòng [${clientRoomId}] & PIN từ QR. Vui lòng nhập tên của bạn 🎤`;
      }
      setTimeout(() => {
        if (joinNameInput) joinNameInput.focus();
      }, 150);
    } else if (clientRoomId && !clientPin) {
      if (joinModalSubtext) {
        joinModalSubtext.textContent = `Phòng [${clientRoomId}]. Nhập mã PIN 4 số trên TV và tên của bạn để vào hát 🎤`;
      }
      setTimeout(() => {
        if (joinPinInput) joinPinInput.focus();
      }, 150);
    } else {
      if (joinModalSubtext) {
        joinModalSubtext.textContent = 'Nhập tên phòng Karaoke, mã PIN trên TV và tên của bạn để tham gia 🎤';
      }
      setTimeout(() => {
        if (joinRoomInput && !joinRoomInput.value.trim()) {
          joinRoomInput.focus();
        } else if (joinPinInput && !joinPinInput.value.trim()) {
          joinPinInput.focus();
        } else if (joinNameInput) {
          joinNameInput.focus();
        }
      }, 150);
    }
  }
}

if (joinRoomForm) {
  joinRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawRoom = (joinRoomInput ? joinRoomInput.value.trim() : '') || clientRoomId || '';
    const rawPin = joinPinInput ? joinPinInput.value.trim() : (clientPin || '');
    const rawName = joinNameInput ? joinNameInput.value.trim() : '';

    if (!rawRoom) {
      if (joinErrorMsg) {
        joinErrorMsg.textContent = 'Vui lòng nhập tên phòng Karaoke (Ví dụ: phong1, vip1...)!';
        joinErrorMsg.classList.remove('hidden');
      }
      if (joinRoomInput) joinRoomInput.focus();
      return;
    }

    if (!rawPin) {
      if (joinErrorMsg) {
        joinErrorMsg.textContent = 'Vui lòng nhập mã PIN 4 số hiển thị trên màn hình TV!';
        joinErrorMsg.classList.remove('hidden');
      }
      if (joinPinInput) joinPinInput.focus();
      return;
    }

    if (!rawName) {
      if (joinErrorMsg) {
        joinErrorMsg.textContent = 'Vui lòng nhập tên của bạn!';
        joinErrorMsg.classList.remove('hidden');
      }
      if (joinNameInput) joinNameInput.focus();
      return;
    }

    attemptVerifyAndJoin(rawName, rawPin, rawRoom);
  });
}

// User Profile modal events
if (userProfileBtn) {
  userProfileBtn.addEventListener('click', openUsernameModal);
}
if (closeUsernameModalBtn) {
  closeUsernameModalBtn.addEventListener('click', closeUsernameModal);
}
if (cancelUsernameBtn) {
  cancelUsernameBtn.addEventListener('click', closeUsernameModal);
}
if (saveUsernameBtn) {
  saveUsernameBtn.addEventListener('click', () => {
    const val = usernameModalInput.value.trim();
    if (val) {
      if (val !== currentUserName) {
        currentUserName = val;
        // Sinh userId mới cho danh tính thành viên mới
        currentUserId = 'uid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        localStorage.setItem('karaoke_user_id', currentUserId);
        localStorage.setItem('karaoke_username', currentUserName);
        sessionStorage.setItem('karaoke_session_joined', 'true');
        hasJoinedRoomInSession = true;
        updateUserNameDisplay();
        socket.emit('join_room', { name: currentUserName, roomId: clientRoomId, userId: currentUserId });
        closeUsernameModal();
        if (currentAppSyncState) {
          updateRoleUI(currentAppSyncState.currentSong, currentAppSyncState.coSingers || []);
        }
        showToast(`Đã đổi tên ca sĩ: "${currentUserName}"`, 'info');
      } else {
        closeUsernameModal();
      }
    }
  });
}
if (usernameModalInput) {
  usernameModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveUsernameBtn.click();
    }
  });
}

// Helper: Escape HTML to prevent injection
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------
// 2 TABS: [🎵 Chọn bài] & [🎉 Tương tác] LOGIC
// -------------------------------------------------------------
const tabActiveClass = 'flex-1 py-2 px-4 rounded-full text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 bg-[#ff0000] text-white shadow-md shadow-red-600/30 cursor-pointer';
const tabInactiveClass = 'flex-1 py-2 px-4 rounded-full text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 text-[#aaaaaa] hover:text-[#f1f1f1] hover:bg-[#272727] cursor-pointer';

function switchClientTab(targetTab: 'songs' | 'reactions') {
  if (!tabBtnSongs || !tabBtnReactions || !tabContentSongs || !tabContentReactions) return;
  if (targetTab === 'songs') {
    tabBtnSongs.className = tabActiveClass;
    tabBtnReactions.className = tabInactiveClass;
    tabContentSongs.classList.remove('hidden');
    tabContentReactions.classList.add('hidden');
  } else {
    tabBtnReactions.className = tabActiveClass;
    tabBtnSongs.className = tabInactiveClass;
    tabContentSongs.classList.add('hidden');
    tabContentReactions.classList.remove('hidden');
    if (currentAppSyncState) {
      updateRoleUI(currentAppSyncState.currentSong, currentAppSyncState.coSingers || []);
    }
    updateGiftButtonsState();
  }
}

if (tabBtnSongs) {
  tabBtnSongs.addEventListener('click', () => switchClientTab('songs'));
}
if (tabBtnReactions) {
  tabBtnReactions.addEventListener('click', () => switchClientTab('reactions'));
}

// Rung nhẹ điện thoại (Haptic feedback)
function triggerHapticFeedback() {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(40);
    }
  } catch {
    // Ignore unsupported devices
  }
}

// Biến lưu trữ điểm cá nhân hiện tại
let myCurrentScore = 50;

// Lấy điểm cá nhân hiện tại từ state hoặc DOM
function getMyCurrentScore(): number {
  if (myScoreEl && myScoreEl.textContent) {
    const parsed = parseInt(myScoreEl.textContent.trim(), 10);
    if (!isNaN(parsed)) return parsed;
  }
  return myCurrentScore;
}

// Cập nhật trạng thái các nút tặng quà: làm mờ và vô hiệu hóa (disabled) nếu vượt quá hoặc dùng hết điểm
function updateGiftButtonsState() {
  const currentScore = getMyCurrentScore();
  const isOutOfPoints = myContributedScore >= currentScore;

  // 1. Dàn nút quà tặng phản ứng nhanh (Tim, Hoa, Cụng ly, Vỗ tay)
  const quickBtns = document.querySelectorAll<HTMLButtonElement>('.reaction-quick-btn');
  quickBtns.forEach((btn) => {
    const cost = Number(btn.dataset.points) || 1;
    const isExceeded = (myContributedScore + cost) > currentScore || isOutOfPoints;
    btn.disabled = isExceeded;
    if (isExceeded) {
      btn.classList.add('opacity-40', 'grayscale', 'cursor-not-allowed');
      btn.classList.remove('active:scale-90', 'active:scale-95');
    } else {
      btn.classList.remove('opacity-40', 'grayscale', 'cursor-not-allowed');
      btn.classList.add('active:scale-90');
    }
  });

  // 2. Nút gửi bình luận (1 điểm)
  const sendCommentBtn = document.getElementById('btn-send-comment') as HTMLButtonElement | null;
  if (sendCommentBtn) {
    const commentExceeded = (myContributedScore + 1) > currentScore || isOutOfPoints;
    sendCommentBtn.disabled = commentExceeded;
    if (commentExceeded) {
      sendCommentBtn.classList.add('opacity-40', 'cursor-not-allowed');
    } else {
      sendCommentBtn.classList.remove('opacity-40', 'cursor-not-allowed');
    }
  }

  // 3. Các chip bình luận nhanh (1 điểm)
  const quickChips = document.querySelectorAll<HTMLButtonElement>('.quick-comment-chip');
  quickChips.forEach((chip) => {
    const chipExceeded = (myContributedScore + 1) > currentScore || isOutOfPoints;
    chip.disabled = chipExceeded;
    if (chipExceeded) {
      chip.classList.add('opacity-40', 'cursor-not-allowed');
    } else {
      chip.classList.remove('opacity-40', 'cursor-not-allowed');
    }
  });
}

// Gửi tương tác phản ứng tới TV Host với CHẶN TRIỆT ĐỂ VIỆC TẶNG ĐIỂM VƯỢT QUÁ ĐIỂM HIỆN CÓ
function sendReactionEvent(type: 'heart' | 'cheers' | 'crown' | 'rocket' | 'flower' | 'clap' | 'comment', points: number, text?: string) {
  if (isCurrentUserSinging) {
    showToast('Bạn đang biểu diễn, hãy tập trung vào bài hát nhé! 🎤', 'info');
    return;
  }

  if (!currentAppSyncState || !currentAppSyncState.currentSong) {
    showToast('Chưa có bài hát nào đang phát trên TV!', 'info');
    return;
  }

  const hasCoSingers = currentAppSyncState?.coSingers && currentAppSyncState.coSingers.length > 0;
  if (!isCurrentSingerOnline && !hasCoSingers) {
    showToast('Ca sĩ chính đang Offline và chưa có ai Hát cùng! Hãy bấm "Hát cùng" để mở khóa tương tác.', 'error');
    return;
  }

  // Lấy điểm cá nhân hiện tại từ state/DOM
  const currentScore = getMyCurrentScore();
  // Tính tổng điểm dự kiến sau khi bấm
  const nextContributed = myContributedScore + points;

  // ĐẶT ĐIỀU KIỆN CHẶN CỨNG
  if (nextContributed > currentScore) {
    alert("Bạn đã dùng hết số điểm hiện có (" + currentScore + " đ) để tặng quà!");
    updateGiftButtonsState();
    return; // NGĂN CHẶN HOÀN TOÀN, KHÔNG GỬI SOCKET LÊN SERVER
  }

  triggerHapticFeedback();

  // Tăng điểm đã tặng cho bài hát hiện tại CHỈ KHI thỏa mãn điều kiện trên
  myContributedScore = nextContributed;
  if (myContributedScoreEl) {
    myContributedScoreEl.textContent = String(myContributedScore);
  }

  // Nếu myContributedScore >= currentScore: làm mờ và vô hiệu hóa các nút
  updateGiftButtonsState();

  socket.emit('send_reaction', {
    roomId: clientRoomId,
    type,
    points,
    userName: currentUserName || 'Bạn bè',
    text: text ? text.substring(0, 30) : undefined
  });
}

// Bấm nút [🎤 Hát cùng] dành cho khán giả
if (joinSingingBtn) {
  joinSingingBtn.addEventListener('click', () => {
    if (isCurrentUserSinging) return;
    const userName = getEffectiveUserName();
    if (!currentAppSyncState || !currentAppSyncState.currentSong) {
      showToast('Hiện chưa có bài hát nào đang phát trên TV', 'info');
      return;
    }
    socket.emit('join_singing', { roomId: clientRoomId, userName: userName || 'Bạn bè' });

    const currentCoSingers = [...(currentAppSyncState.coSingers || [])];
    if (userName && !currentCoSingers.some((cs) => cs.toLowerCase() === userName.toLowerCase())) {
      currentCoSingers.push(userName);
    }
    if (currentAppSyncState) {
      currentAppSyncState.coSingers = currentCoSingers;
    }
    updateRoleUI(currentAppSyncState.currentSong, currentCoSingers);
    showToast('🎤 Bạn đã tham gia hát (Phụ)!', 'priority');
  });
}

// Bấm nút phản ứng nhanh (Tim 1đ, Cụng ly 5đ, Vương miện 20đ, Tên lửa 50đ)
document.querySelectorAll<HTMLButtonElement>('.reaction-quick-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type as 'heart' | 'cheers' | 'crown' | 'rocket' | 'flower' | 'clap';
    const points = Number(btn.dataset.points) || 1;
    if (type) {
      sendReactionEvent(type, points);

      // Hiệu ứng nảy nút vui mắt
      btn.classList.add('scale-110');
      setTimeout(() => btn.classList.remove('scale-110'), 150);
    }
  });
});

// Xử lý gửi bình luận ngắn (Danmaku)
if (reactionCommentInput) {
  reactionCommentInput.addEventListener('input', () => {
    if (commentCharCount) {
      commentCharCount.textContent = `${reactionCommentInput.value.length}/30`;
    }
  });
}

if (reactionCommentForm && reactionCommentInput) {
  reactionCommentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const comment = reactionCommentInput.value.trim();
    if (!comment) {
      reactionCommentInput.focus();
      return;
    }
    sendReactionEvent('comment', 1, comment);
    reactionCommentInput.value = '';
    if (commentCharCount) commentCharCount.textContent = '0/30';
    showToast('Đã gửi lời cổ vũ bay lên TV! 🚀', 'success');
  });
}

// Gợi ý bình luận nhanh
document.querySelectorAll<HTMLButtonElement>('.quick-comment-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const text = chip.dataset.text;
    if (text) {
      sendReactionEvent('comment', 1, text);
      showToast(`Đã gửi: "${text}"`, 'success');
    }
  });
});

// Thêm phản ứng vào danh sách Không khí phòng hát
function appendReactionToFeed(data: {
  type: string;
  userName: string;
  text?: string;
  points: number;
}) {
  if (!recentReactionsFeed) return;
  if (reactionsFeedEmpty) reactionsFeedEmpty.classList.add('hidden');

  const item = document.createElement('div');
  item.className = 'text-xs p-2 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-center justify-between gap-2 transition-all';

  let icon = '❤️';
  let actionName = 'thả tim';
  let badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';

  if (data.type === 'cheers') {
    icon = '🍻';
    actionName = 'cụng ly';
    badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  } else if (data.type === 'crown') {
    icon = '👑';
    actionName = 'tặng vương miện';
    badgeColor = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
  } else if (data.type === 'rocket') {
    icon = '🚀';
    actionName = 'bắn tên lửa';
    badgeColor = 'bg-gradient-to-r from-orange-500/30 to-rose-500/30 text-orange-300 border-orange-500/50 shadow-sm shadow-orange-500/20';
  } else if (data.type === 'flower') {
    icon = '💐';
    actionName = 'tặng hoa';
    badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  } else if (data.type === 'clap') {
    icon = '👏';
    actionName = 'vỗ tay';
    badgeColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
  } else if (data.type === 'comment') {
    icon = '💬';
    actionName = 'bình luận';
    badgeColor = 'bg-red-500/20 text-red-300 border-red-500/40';
  }

  const contentHtml = data.type === 'comment' && data.text
    ? `<span class="font-bold text-white">${escapeHtml(data.userName)}:</span> <span class="text-neutral-300 font-medium italic truncate">"${escapeHtml(data.text)}"</span>`
    : `<span class="font-bold text-white">${escapeHtml(data.userName)}</span> <span class="text-neutral-400">${actionName}</span>`;

  item.innerHTML = `
    <div class="flex items-center gap-2 min-w-0 flex-1 truncate">
      <span class="text-base">${icon}</span>
      <span class="truncate">${contentHtml}</span>
    </div>
    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${badgeColor} shrink-0">
      +${data.points}đ
    </span>
  `;

  recentReactionsFeed.insertBefore(item, recentReactionsFeed.firstChild);

  // Giữ tối đa 20 mục
  while (recentReactionsFeed.children.length > 20) {
    recentReactionsFeed.removeChild(recentReactionsFeed.lastChild!);
  }
}

// Socket.io Events
socket.on('connect', () => {
  console.log('⚡ Client connected to Karaoke Server. Room:', clientRoomId);
  if (connectionDotEl) {
    connectionDotEl.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0';
  }
  if (connectionStatusEl) {
    connectionStatusEl.className = 'text-xs font-medium text-emerald-300 whitespace-nowrap';
    connectionStatusEl.innerText = clientRoomId ? `Phòng: ${clientRoomId}` : 'Đã kết nối TV';
  }
  if (clientRoomId) {
    socket.emit('get_state', { roomId: clientRoomId });
    socket.emit('remote_unmute', { roomId: clientRoomId });
  }

  // Tự động reconnect với thông tin đã lưu trong localStorage (userId, roomPin, userName, roomId)
  const user = getEffectiveUserName();
  const pin = clientPin || localStorage.getItem('karaoke_client_pin') || '';
  const room = clientRoomId || localStorage.getItem('karaoke_client_room') || '';
  if (user && pin && room) {
    clientPin = pin;
    clientRoomId = room;
    attemptVerifyAndJoin(user, pin, room);
  }
});

// Xử lý sự kiện phòng bị TV Host làm mới / F5
socket.on('room_reset', (data: { roomId: string; message: string }) => {
  console.warn('⚠️ Room reset by TV Host:', data);
  showToast(data?.message || 'Phòng hát đã được làm mới. Vui lòng quét lại mã QR trên TV hoặc nhập mã PIN mới!', 'error');
  sessionStorage.removeItem('karaoke_session_joined');
  sessionStorage.removeItem('karaoke_client_pin');
  localStorage.removeItem('karaoke_client_pin');
  hasJoinedRoomInSession = false;
  clientPin = '';

  if (joinPinInput) {
    joinPinInput.value = '';
    joinPinInput.focus();
  }
  if (pinBadgeAuto) {
    pinBadgeAuto.classList.add('hidden');
  }
  if (joinErrorMsg) {
    joinErrorMsg.textContent = data?.message || 'Phòng hát đã được làm mới. Vui lòng nhập mã PIN 4 số trên màn hình TV!';
    joinErrorMsg.classList.remove('hidden');
  }
  if (joinRoomModal) {
    joinRoomModal.classList.remove('hidden');
  }
});

// Tự động đồng bộ và kết nối lại khi điện thoại bật mạng trở lại hoặc mở lại ứng dụng
window.addEventListener('online', () => {
  const user = getEffectiveUserName();
  const pin = clientPin || localStorage.getItem('karaoke_client_pin') || '';
  const room = clientRoomId || localStorage.getItem('karaoke_client_room') || '';
  if (user && pin && room && socket.connected) {
    clientPin = pin;
    clientRoomId = room;
    attemptVerifyAndJoin(user, pin, room);
    socket.emit('get_state', { roomId: clientRoomId });
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const user = getEffectiveUserName();
    const pin = clientPin || localStorage.getItem('karaoke_client_pin') || '';
    const room = clientRoomId || localStorage.getItem('karaoke_client_room') || '';
    if (user && pin && room && socket.connected) {
      clientPin = pin;
      clientRoomId = room;
      attemptVerifyAndJoin(user, pin, room);
      socket.emit('get_state', { roomId: clientRoomId });
    }
  }
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from Karaoke Server');
  if (connectionDotEl) {
    connectionDotEl.className = 'w-2 h-2 rounded-full bg-rose-500 shrink-0';
  }
  if (connectionStatusEl) {
    connectionStatusEl.className = 'text-xs font-medium text-rose-400 whitespace-nowrap';
    connectionStatusEl.innerText = 'Mất kết nối TV';
  }
});

socket.on('singer_connection_changed', (data: { isOnline: boolean; singerName: string }) => {
  isCurrentSingerOnline = data.isOnline;
  updateInteractionLockState();
  if (!data.isOnline && data.singerName) {
    showToast(`⚠️ Ca sĩ ${data.singerName} đang mất kết nối!`, 'error');
  }
});

socket.on('sync_state', (state: SyncStateData) => {
  updateSyncState(state);
});

socket.on('queue_updated', (updatedQueue: SongItem[]) => {
  if (currentAppSyncState) {
    currentAppSyncState.queue = updatedQueue || [];
    currentAppSyncState.totalWaiting = (updatedQueue || []).length;
    updateSyncState(currentAppSyncState);
  } else {
    renderModalQueue(updatedQueue || []);
  }
});

socket.on('play_song', (song: SongItem) => {
  if (currentAppSyncState) {
    currentAppSyncState.currentSong = song;
    currentAppSyncState.coSingers = [];
  }
  updateRoleUI(song, []);
});

socket.on('co_singers_updated', (data: { coSingers: string[]; currentSong: SongItem }) => {
  if (currentAppSyncState) {
    currentAppSyncState.coSingers = data.coSingers;
    currentAppSyncState.currentSong = data.currentSong;
  }
  updateRoleUI(data.currentSong, data.coSingers || []);
});

// Render Modal Bảng xếp hạng thành viên sắp xếp giảm dần theo điểm số
function renderLeaderboard(members: RoomMember[]) {
  const sorted = [...(members || [])].sort((a, b) => {
    const scoreB = (b.score ?? (b as any).points ?? 0);
    const scoreA = (a.score ?? (a as any).points ?? 0);
    return scoreB - scoreA;
  });
  latestRoomMembers = sorted;

  if (!leaderboardListEl) return;
  if (sorted.length === 0) {
    leaderboardListEl.innerHTML = '<div class="text-center py-6 text-xs text-neutral-500 italic">Chưa có thành viên nào trong phòng</div>';
    return;
  }

  const myName = getEffectiveUserName().trim().toLowerCase();
  const currentSinger = (currentAppSyncState?.currentSong?.userName || '').trim().toLowerCase();
  const currentCoSingers = (currentAppSyncState?.coSingers || []).map((s) => s.trim().toLowerCase());

  leaderboardListEl.innerHTML = sorted.map((m, index) => {
    const isMe = m.name.trim().toLowerCase() === myName;
    const isMainSinger = currentSinger && m.name.trim().toLowerCase() === currentSinger;
    const isCoSinger = currentCoSingers.includes(m.name.trim().toLowerCase());
    const isOffline = m.isOnline === false || !m.isOnline;
    const isLeadSingerOnline = currentAppSyncState?.isSingerOnline !== false;
    const rankBadge = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `<span class="text-xs text-neutral-500 font-bold">#${index + 1}</span>`;

    let statusBadge = '';
    if (isMainSinger) {
      if (isLeadSingerOnline && !isOffline) {
        statusBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Ca sĩ chính</span>';
      } else {
        statusBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse">Chính (off)</span>';
      }
    } else if (isCoSinger) {
      if (isOffline) {
        statusBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-950/80 border border-red-500/40 text-red-300">Hát cùng <span class="text-red-400 font-black animate-pulse">(off)</span></span>';
      } else {
        statusBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-950/80 border border-red-500/40 text-red-300">Hát cùng</span>';
      }
    } else if (isOffline) {
      statusBadge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 animate-pulse">(off)</span>';
    }

    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl border ${
        isMe
          ? 'bg-amber-500/10 border-amber-500/40 shadow-sm'
          : isMainSinger || isCoSinger
          ? 'bg-red-950/60 border-red-700/50'
          : isOffline
          ? 'bg-[#121212]/80 border-[#3f3f3f]/50 opacity-60'
          : 'bg-[#272727] border-[#3f3f3f]'
      } transition">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-6 text-center shrink-0 text-sm">${rankBadge}</span>
          <div class="truncate">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-bold text-xs text-[#f1f1f1] truncate ${isMe ? 'text-amber-300' : ''}">
                ${escapeHtml(m.name)} ${isMe ? '<span class="text-[10px] text-amber-400 font-normal">(Bạn)</span>' : ''}
              </span>
              ${statusBadge}
            </div>
          </div>
        </div>
        <div class="shrink-0 font-extrabold text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-1 rounded-full">
          ${m.score ?? (m as any).points ?? 0} đ
        </div>
      </div>
    `;
  }).join('');
}

function openLeaderboardModal() {
  if (!leaderboardModal) return;
  renderLeaderboard(latestRoomMembers);
  leaderboardModal.classList.remove('opacity-0', 'pointer-events-none');
}

function closeLeaderboardModal() {
  if (!leaderboardModal) return;
  leaderboardModal.classList.add('opacity-0', 'pointer-events-none');
}

if (openLeaderboardBtn) {
  openLeaderboardBtn.addEventListener('click', openLeaderboardModal);
}
if (closeLeaderboardBtn) {
  closeLeaderboardBtn.addEventListener('click', closeLeaderboardModal);
}
if (leaderboardModal) {
  leaderboardModal.addEventListener('click', (e) => {
    if (e.target === leaderboardModal) {
      closeLeaderboardModal();
    }
  });
}

// Đồng bộ điểm cá nhân từ bảng thành viên
function updateMyScoreDisplay(membersList?: RoomMember[]) {
  if (!myScoreEl) return;
  if (!membersList || membersList.length === 0) {
    return;
  }
  const myName = getEffectiveUserName().trim().toLowerCase();
  const me = membersList.find(
    (m) => m && m.name && myName && m.name.trim().toLowerCase() === myName
  );
  if (me && typeof me.score === 'number') {
    myCurrentScore = me.score;
    myScoreEl.textContent = String(me.score);
  }
  updateGiftButtonsState();
}

socket.on('update_members', (membersList: RoomMember[]) => {
  const sorted = [...(membersList || [])].sort((a, b) => {
    const scoreB = (b.score ?? (b as any).points ?? 0);
    const scoreA = (a.score ?? (a as any).points ?? 0);
    return scoreB - scoreA;
  });
  latestRoomMembers = sorted;
  renderLeaderboard(latestRoomMembers);
  updateMyScoreDisplay(latestRoomMembers);
});

socket.on('new_reaction', (data: any) => {
  appendReactionToFeed(data);
});

socket.on('song_added_success', (data: { song: SongItem; priority?: boolean }) => {
  // Confirmation from server
});

socket.on('error_message', (msg: string) => {
  showToast(msg, 'error');
});

// Initial boot: check room join flow and show clean initial prompt
initJoinRoomFlow();
showInitialSearchPrompt();

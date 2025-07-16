'use strict'; // Enable strict mode for better error checking

(function() {
  // --- Security: YouTube Data API Key ---
  // IMPORTANT: The API key has been removed from the source code for security.
  // In a real-world application, you should NEVER expose your API key on the client-side.
  // Instead, create a backend server (a "proxy") that securely stores the key
  // and makes requests to the YouTube API on behalf of your app.
  // For development, you can paste your key here, but do not commit it to version control.
  const YOUTUBE_API_KEY = 'AIzaSyDBQ9OjY2XW8DY7-WpPb6Q2LURnWCzkoAY'; // <--- REPLACE THIS LINE WITH YOUR ACTUAL KEY FROM GOOGLE CLOUD CONSOLE

  // --- IndexedDB Setup ---
  const IDB_DATABASE_NAME = 'music-db';
  const IDB_STORE_NAME = 'tracks';
  let db; // Global IndexedDB database instance

  /**
   * Opens the IndexedDB database.
   * Creates the object store if it doesn't exist.
   * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
   */
  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_DATABASE_NAME, 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // --- UI Feedback ---
  const uiMessageElement = document.getElementById('ui-message');
  let messageTimeout;

  /**
   * Displays a message to the user in the UI.
   * @param {string} message The text to display.
   * @param {string} type The type of message ('success', 'error', 'info').
   * @param {number} duration The duration in milliseconds to show the message.
   */
  function showUIMessage(message, type = 'info', duration = 3000) {
    clearTimeout(messageTimeout); // Clear any existing message timeout
    uiMessageElement.textContent = message;
    uiMessageElement.className = `ui-message ${type} show`; // Add type and show classes
    
    messageTimeout = setTimeout(() => {
      uiMessageElement.classList.remove('show');
    }, duration);
  }
  
  // --- Audio Context and Visualizer ---
  let audioContext;
  let analyser;
  let sourceNode; // The AudioNode connected to the analyser (MediaElementSource or YouTube source)
  let visualizerCanvas;
  let visualizerCtx;
  let bufferLength;
  let dataArray;

  /**
   * Sets up the visualizer canvas and context.
   */
  function setupVisualizer() {
    visualizerCanvas = document.getElementById('visualizer');
    visualizerCtx = visualizerCanvas.getContext('2d');
    // Set canvas resolution to match its displayed size
    visualizerCanvas.width = visualizerCanvas.offsetWidth;
    visualizerCanvas.height = visualizerCanvas.offsetHeight;

    // Create AudioContext only on first user gesture to comply with browser autoplay policies
    document.addEventListener('click', initAudioContext, { once: true });
    document.addEventListener('keydown', initAudioContext, { once: true });
  }

  /**
   * Initializes the AudioContext and AnalyserNode.
   * This function is called on the first user interaction.
   */
  function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256; // Fast Fourier Transform size (number of samples in frequency data)
      bufferLength = analyser.frequencyBinCount; // Number of data points (half of fftSize)
      dataArray = new Uint8Array(bufferLength); // Array to hold frequency data (byte values)

      // Connect analyser to the audio output (speakers)
      analyser.connect(audioContext.destination);
      drawVisualizer(); // Start drawing once context is ready
    }
  }

  /**
   * Connects an audio source node to the analyser for visualization.
   * Disconnects any previously connected source.
   * @param {AudioNode} audioNode The audio source node to connect (e.g., MediaElementSource).
   */
  function connectSourceToVisualizer(audioNode) {
    // Disconnect old source if it exists to prevent multiple connections
    if (sourceNode) {
      sourceNode.disconnect(analyser);
    }
    sourceNode = audioNode;
    sourceNode.connect(analyser);
  }

  /**
   * Draws the audio visualization on the canvas.
   * This function is called in a loop using requestAnimationFrame.
   */
  function drawVisualizer() {
    requestAnimationFrame(drawVisualizer); // Loop this function for continuous animation

    if (!analyser || !dataArray) return; // Ensure analyser is initialized

    analyser.getByteFrequencyData(dataArray); // Get frequency data from the analyser

    visualizerCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height); // Clear canvas for new frame

    const barWidth = (visualizerCanvas.width / bufferLength) * 2.5; // Calculate bar width based on canvas width and data points
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = dataArray[i]; // Get bar height from frequency data (0-255)

      // Create a gradient for the bars
      const gradient = visualizerCtx.createLinearGradient(0, visualizerCanvas.height, 0, visualizerCanvas.height - barHeight);
      gradient.addColorStop(0, 'var(--primary-color)');
      gradient.addColorStop(1, '#68d391'); // Lighter green

      visualizerCtx.fillStyle = gradient;
      visualizerCtx.fillRect(x, visualizerCanvas.height - barHeight, barWidth, barHeight);

      x += barWidth + 1; // Move to the right for the next bar, with a small gap
    }
  }

  // --- Track Management (Local Files, Streams, and YouTube) ---
  let library = []; // Stores all tracks added by the user (primarily local files)
  let playlist = []; // The currently active playlist, can contain local, stream, or YouTube tracks
  let currentTrackIndex = -1; // Index of the currently playing track in the playlist
  let audio = new Audio(); // HTML5 Audio element for local files and direct streams
  let isPlaying = false;
  let currentTrackType = 'local'; // 'local', 'stream', or 'youtube'

  // --- DOM Elements ---
  const addMusicFileInput = document.getElementById('add-music-file-input');
  const streamUrlInput = document.getElementById('stream-url-input');
  const playStreamBtn = document.getElementById('play-stream-btn');
  const playlistList = document.getElementById('playlist-list');
  const libraryList = document.getElementById('library-list');
  const noPlaylistMessage = document.getElementById('no-playlist-message');
  const noLibraryMessage = document.getElementById('no-library-message');

  const playPauseBtn = document.getElementById('play-pause-btn');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const progressBar = document.getElementById('progress-bar');
  const progressBarContainer = document.getElementById('progress-bar-container');
  const currentTimeSpan = document.getElementById('current-time');
  const durationSpan = document.getElementById('duration');
  const currentTrackTitle = document.getElementById('current-track-title');
  const currentTrackArtist = document.getElementById('current-track-artist');

  // Tab Buttons
  const playlistTabBtn = document.getElementById('playlist-tab-btn');
  const libraryTabBtn = document.getElementById('library-tab-btn');
  const playlistTab = document.getElementById('playlist-tab');
  const libraryTab = document.getElementById('library-tab');

  // Library Filter Buttons
  const viewAllSongsBtn = document.getElementById('view-all-songs-btn');
  const viewAlbumsBtn = document.getElementById('view-albums-btn');
  const viewArtistsBtn = document.getElementById('view-artists-btn');
  const viewGenresBtn = document.getElementById('view-genres-btn');
  const clearFilterBtn = document.getElementById('clear-filter-btn');

  // YouTube Integration Elements
  const youtubeUrlInput = document.getElementById('youtube-url-input');
  const playYoutubeBtn = document.getElementById('play-youtube-btn');
  let youtubePlayer; // Variable to hold the YouTube player instance

  // New YouTube Playlist Elements
  const youtubePlaylistUrlInput = document.getElementById('youtube-playlist-url-input');
  const addYoutubePlaylistBtn = document.getElementById('add-youtube-playlist-btn');

  // --- YouTube IFrame Player API Functions ---
  /**
   * This function is called by the YouTube API when it's fully loaded.
   * Initializes the YouTube player.
   */
  window.onYouTubeIframeAPIReady = function() {
      console.log("YouTube IFrame API is Ready.");
      youtubePlayer = new YT.Player('youtube-player', {
          height: '0', // Make the player invisible
          width: '0',  // Make the player invisible
          videoId: '', // No video ID initially
          playerVars: {
              'autoplay': 1,
              'controls': 0,
              'disablekb': 1,
              'modestbranding': 1,
              'rel': 0,
              'enablejsapi': 1,
              'html5': 1 // Prefer HTML5 player over Flash
          },
          events: {
              'onReady': onPlayerReady,
              'onStateChange': onPlayerStateChange,
              'onError': onPlayerError
          }
      });
  };

  /**
   * Callback function when the YouTube player is ready.
   * @param {Object} event The YouTube player event object.
   */
  function onPlayerReady(event) {
      console.log('YouTube player ready.');
      if (youtubePlayer) {
          youtubePlayer.setVolume(volumeSlider.value);
      }
  }
  
  /**
   * Callback for YouTube player errors.
   * @param {object} event The error event.
   */
  function onPlayerError(event) {
      console.error('YouTube Player Error:', event.data);
      showUIMessage(`YouTube player error: ${event.data}`, 'error');
      playNextTrack(); // Try to play the next track
  }

  /**
   * Callback function when the YouTube player's state changes.
   * Handles play/pause, ended, and buffering states.
   * @param {Object} event The YouTube player event object.
   */
  function onPlayerStateChange(event) {
      const state = event.data;
      switch (state) {
          case YT.PlayerState.PLAYING:
              isPlaying = true;
              updatePlayPauseButton();
              updateMediaSession();
              break;
          case YT.PlayerState.PAUSED:
              isPlaying = false;
              updatePlayPauseButton();
              break;
          case YT.PlayerState.ENDED:
              playNextTrack(); // Auto-play next if YouTube track ends
              break;
      }
      updateProgressBarAndTimer(); // Update UI for YouTube playback
  }

  /**
   * Plays a specific YouTube video by its ID.
   * @param {string} videoId The ID of the YouTube video.
   */
  function playYouTubeAudio(videoId) {
      if (!youtubePlayer || typeof youtubePlayer.loadVideoById !== 'function') {
          showUIMessage("YouTube player is not ready yet.", 'error');
          return;
      }
      if (!audio.paused) audio.pause();
      
      currentTrackType = 'youtube';
      youtubePlayer.loadVideoById(videoId);
      isPlaying = true;
      updatePlayPauseButton();
      updateCurrentTrackInfo();
  }

  /**
   * Extracts the video ID from a YouTube video URL.
   * @param {string} url The YouTube video URL.
   * @returns {string|null} The video ID or null if not found.
   */
  function extractYouTubeVideoId(url) {
      const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|\/(?:v|e(?:mbed)?)\/|watch\?v=)|youtu\.be\/)([^&?#]{11})/;
      const match = url.match(regExp);
      return (match && match[1]) ? match[1] : null;
  }

  /**
   * Extracts the playlist ID from a YouTube playlist URL.
   * @param {string} url The YouTube playlist URL.
   * @returns {string|null} The playlist ID or null if not found.
   */
  function extractYouTubePlaylistId(url) {
      const regExp = /[?&]list=([^&#]+)/;
      const match = url.match(regExp);
      return (match && match[1]) ? match[1] : null;
  }

  /**
   * Fetches and adds all videos from a YouTube playlist to the application's playlist.
   * @param {string} playlistId The ID of the YouTube playlist.
   */
  async function addYouTubePlaylist(playlistId) {
      // Check if API key is configured
      if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'PASTE YOUR YOUTUBE API KEY HERE FOR DEVELOPMENT') {
          showUIMessage("YouTube API Key is not configured. Please replace the placeholder.", 'error', 7000);
          return;
      }

      let nextPageToken = '';
      let playlistTitle = 'YouTube Playlist';
      let videosAdded = 0;
      showUIMessage('Fetching playlist...', 'info', 10000);

      try {
          // Fetch playlist details (title)
          // This call uses the YouTube Data API to get information about the playlist itself.
          const detailsUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${YOUTUBE_API_KEY}`;
          const detailsResponse = await fetch(detailsUrl);
          if (!detailsResponse.ok) throw new Error(`HTTP error! status: ${detailsResponse.status}`);
          const detailsData = await detailsResponse.json();
          if (detailsData.items && detailsData.items.length > 0) {
              playlistTitle = detailsData.items[0].snippet.title;
          }

          // Fetch playlist items (videos)
          // This loop makes multiple calls to the YouTube Data API to get all videos in the playlist,
          // handling pagination with nextPageToken.
          do {
              const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
              const response = await fetch(itemsUrl);
              if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
              const data = await response.json();

              if (data.items) {
                  data.items.forEach(item => {
                      const { videoId } = item.snippet.resourceId;
                      const { title, channelTitle } = item.snippet;
                      if (videoId && title !== 'Private video' && title !== 'Deleted video') {
                          const youtubeTrack = {
                              id: videoId,
                              url: `https://www.youtube.com/watch?v=${videoId}`, // Full YouTube video URL
                              videoId: videoId,
                              type: 'youtube',
                              title: title,
                              artist: channelTitle,
                              album: playlistTitle,
                              genre: 'Video'
                          };
                          // Prevent duplicate entries in the playlist
                          if (!playlist.some(t => t.id === videoId)) {
                              playlist.push(youtubeTrack);
                              videosAdded++;
                          }
                      }
                  });
                  nextPageToken = data.nextPageToken;
              } else {
                  nextPageToken = null;
              }
          } while (nextPageToken);

          renderPlaylist();
          showUIMessage(`Added ${videosAdded} videos from "${playlistTitle}"`, 'success');
          showTab('playlist-tab');

      } catch (error) {
          console.error("Error fetching YouTube playlist:", error);
          showUIMessage('Failed to fetch playlist. Check URL or API key.', 'error', 5000);
      }
  }


  // --- General Player Control Functions (adapted for YouTube) ---
  /**
   * Plays the currently selected track in the playlist.
   * Handles local, stream, and YouTube track types.
   */
  function playCurrentTrack() {
    if (playlist.length === 0 || currentTrackIndex === -1) {
        pauseCurrentTrack();
        updateCurrentTrackInfo(); // Update UI to show "No track playing"
        return;
    }

    const track = playlist[currentTrackIndex];

    // Pause any currently playing audio/YouTube video before switching
    if (!audio.paused) audio.pause();
    if (youtubePlayer && typeof youtubePlayer.pauseVideo === 'function' && youtubePlayer.getPlayerState() === 1) {
        youtubePlayer.pauseVideo();
    }

    currentTrackType = track.type;

    if (track.type === 'youtube') {
        playYouTubeAudio(track.videoId);
    } else {
        // This handles both 'local' and 'stream' types
        audio.src = track.type === 'local' ? URL.createObjectURL(track.file) : track.url;
        audio.play().catch(e => {
            console.error("Error playing audio:", e);
            showUIMessage(`Could not play track: ${track.title}`, 'error');
        });
        if (audioContext) {
            // This requires a Cross-Origin header for streams, may not always work
            try {
                if (!sourceNode || sourceNode.mediaElement !== audio) {
                    connectSourceToVisualizer(audioContext.createMediaElementSource(audio));
                }
            } catch (e) {
                console.warn("Could not connect audio to visualizer (CORS issue with stream?).", e);
            }
        }
    }

    isPlaying = true;
    updatePlayPauseButton();
    updateCurrentTrackInfo();
    renderPlaylist();
  }

  /**
   * Pauses the currently playing track (local, stream, or YouTube).
   */
  function pauseCurrentTrack() {
    if (currentTrackType === 'youtube' && youtubePlayer && typeof youtubePlayer.pauseVideo === 'function') {
        youtubePlayer.pauseVideo();
    } else {
        audio.pause();
    }
    isPlaying = false;
    updatePlayPauseButton();
  }

  /**
   * Toggles play/pause for the current track.
   */
  function togglePlayPause() {
    if (currentTrackIndex === -1 && playlist.length > 0) {
        currentTrackIndex = 0;
    }
    
    if (isPlaying) {
      pauseCurrentTrack();
    } else {
      playCurrentTrack();
    }
  }

  /**
   * Plays the next track in the playlist.
   */
  function playNextTrack() {
    if (playlist.length === 0) return;
    currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
    playCurrentTrack();
  }

  /**
   * Plays the previous track in the playlist.
   */
  function playPrevTrack() {
    if (playlist.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
    playCurrentTrack();
  }

  /**
   * Updates the play/pause button icon based on the playing state.
   */
  function updatePlayPauseButton() {
    playPauseBtn.textContent = isPlaying ? '⏸️' : '▶️';
  }

  /**
   * Updates the displayed title and artist of the current track.
   */
  function updateCurrentTrackInfo() {
    if (currentTrackIndex > -1 && playlist[currentTrackIndex]) {
      const track = playlist[currentTrackIndex];
      currentTrackTitle.textContent = track.title || 'Unknown Title';
      currentTrackArtist.textContent = track.artist ? `${track.artist} - ${track.album || 'Unknown Album'}` : 'Unknown Artist';
    } else {
      currentTrackTitle.textContent = 'No track playing';
      currentTrackArtist.textContent = 'Artist - Album';
      progressBar.style.width = '0%';
      currentTimeSpan.textContent = '0:00';
      durationSpan.textContent = '0:00';
    }
  }

  /**
   * Formats time in seconds into a "MM:SS" string.
   */
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
  }

  /**
   * Updates the progress bar and current/total time display.
   */
  function updateProgressBarAndTimer() {
    let current = 0, total = 0;

    if (currentTrackType === 'youtube' && youtubePlayer && typeof youtubePlayer.getDuration === 'function') {
        current = youtubePlayer.getCurrentTime();
        total = youtubePlayer.getDuration();
    } else if (audio && !isNaN(audio.duration)) {
        current = audio.currentTime;
        total = audio.duration;
    }

    currentTimeSpan.textContent = formatTime(current);
    durationSpan.textContent = formatTime(total);
    progressBar.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
  }
  
  // --- Media Session API Integration ---
  /**
   * Updates the Media Session metadata for native OS media controls.
   */
  function updateMediaSession() {
    if ('mediaSession' in navigator && currentTrackIndex > -1) {
        const track = playlist[currentTrackIndex];
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album: track.album || 'Unknown Album',
            artwork: [
                // You could fetch album art here if available
                { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
            ]
        });
    }
  }

  /**
   * Sets up the action handlers for the Media Session API.
   */
  function setupMediaSessionHandlers() {
      if ('mediaSession' in navigator) {
          navigator.mediaSession.setActionHandler('play', togglePlayPause);
          navigator.mediaSession.setActionHandler('pause', togglePlayPause);
          navigator.mediaSession.setActionHandler('previoustrack', playPrevTrack);
          navigator.mediaSession.setActionHandler('nexttrack', playNextTrack);
      }
  }

  // --- Track Adding and Rendering ---
  /**
   * Adds local audio files selected by the user to the library and IndexedDB.
   */
  async function addLocalFiles(files) {
    let filesAdded = 0;
    for (const file of files) {
      if (file.type.startsWith('audio/')) {
        const track = {
          id: Date.now() + Math.random(), // Simple unique ID
          name: file.name,
          file: file, // Store the File object directly
          type: 'local',
          title: file.name.replace(/\.[^/.]+$/, ""), // Remove extension for title
          artist: 'Unknown Artist', // Placeholder, can be parsed from metadata
          album: 'Unknown Album',
          genre: 'Unknown Genre'
        };
        await saveTrackToIndexedDB(track);
        filesAdded++;
      }
    }
    if (filesAdded > 0) {
        await loadTracksFromIndexedDB();
        renderLibraryList('all');
        showUIMessage(`Added ${filesAdded} local file(s)`, 'success');
    }
  }

  /**
   * Saves a track object to IndexedDB.
   */
  async function saveTrackToIndexedDB(track) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(IDB_STORE_NAME);
      const request = store.add(track);
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Loads all tracks from IndexedDB into the global library array.
   */
  async function loadTracksFromIndexedDB() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = transaction.objectStore(IDB_STORE_NAME);
      const request = store.getAll();
      request.onsuccess = (event) => {
        library = event.target.result.filter(t => t.type === 'local');
        resolve();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Renders the music library list based on the specified filter type and value.
   */
  function renderLibraryList(filterType = 'all', filterValue = '') {
    libraryList.innerHTML = ''; // Clear previous list
    let filteredLibrary = [];

    if (filterType === 'all') {
      filteredLibrary = library;
    } else if (filterType === 'albums') {
      const albums = [...new Set(library.map(t => t.album || 'Unknown Album'))];
      if (!filterValue) { // Show album titles for selection
          albums.forEach(album => {
              const li = document.createElement('li');
              li.textContent = `Album: ${album}`;
              li.classList.add('album-filter-item');
              li.dataset.filterValue = album;
              li.addEventListener('click', () => renderLibraryList('albums', album));
              libraryList.appendChild(li);
          });
          noLibraryMessage.style.display = albums.length === 0 ? 'block' : 'none';
          return; // Exit as we're showing album choices, not tracks
      } else { // Show tracks for selected album
          filteredLibrary = library.filter(track => (track.album || 'Unknown Album') === filterValue);
      }
    } else if (filterType === 'artists') {
        const artists = [...new Set(library.map(t => t.artist || 'Unknown Artist'))];
        if (!filterValue) {
            artists.forEach(artist => {
                const li = document.createElement('li');
                li.textContent = `Artist: ${artist}`;
                li.classList.add('artist-filter-item');
                li.dataset.filterValue = artist;
                li.addEventListener('click', () => renderLibraryList('artists', artist));
                libraryList.appendChild(li);
            });
            noLibraryMessage.style.display = artists.length === 0 ? 'block' : 'none';
            return;
        } else {
            filteredLibrary = library.filter(track => (track.artist || 'Unknown Artist') === filterValue);
        }
    } else if (filterType === 'genres') {
        const genres = [...new Set(library.map(t => t.genre || 'Unknown Genre'))];
        if (!filterValue) {
            genres.forEach(genre => {
                const li = document.createElement('li');
                li.textContent = `Genre: ${genre}`;
                li.classList.add('genre-filter-item');
                li.dataset.filterValue = genre;
                li.addEventListener('click', () => renderLibraryList('genres', genre));
                libraryList.appendChild(li);
            });
            noLibraryMessage.style.display = genres.length === 0 ? 'block' : 'none';
            return;
        } else {
            filteredLibrary = library.filter(track => (track.genre || 'Unknown Genre') === filterValue);
        }
    }

    noLibraryMessage.style.display = filteredLibrary.length === 0 ? 'block' : 'none';

    filteredLibrary.forEach((track) => {
      const li = document.createElement('li');
      li.dataset.trackId = track.id;

      li.innerHTML = `
        <div class="track-info">
          <strong>${track.title || track.name}</strong>
          <span>${track.artist || 'Unknown Artist'} - ${track.album || 'Unknown Album'}</span>
        </div>
        <div class="playlist-actions">
            <button class="add-to-playlist-btn" data-track-id="${track.id}" title="Add to Playlist">➕</button>
        </div>
      `;
      libraryList.appendChild(li);

      li.querySelector('.add-to-playlist-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        const trackIdToAdd = parseFloat(event.target.dataset.trackId);
        const trackToAdd = library.find(t => t.id === trackIdToAdd);
        if (trackToAdd && !playlist.some(p => p.id === trackToAdd.id)) {
            playlist.push(trackToAdd);
            renderPlaylist();
            showUIMessage(`Added "${trackToAdd.title}" to playlist`, 'success');
            showTab('playlist-tab');
        } else {
            showUIMessage(`"${trackToAdd.title}" is already in the playlist`, 'info');
        }
      });
    });
  }

  /**
   * Renders the current playlist in the playlist tab.
   */
  function renderPlaylist() {
    playlistList.innerHTML = '';
    noPlaylistMessage.style.display = playlist.length === 0 ? 'block' : 'none';

    playlist.forEach((track, index) => {
      const li = document.createElement('li');
      li.dataset.index = index;
      li.classList.toggle('playing', index === currentTrackIndex);

      const displayTitle = track.type === 'youtube' ? `YouTube: ${track.title}` : (track.title || track.name);
      const displayArtist = track.artist ? `${track.artist} - ${track.album || 'Unknown Album'}` : 'Unknown Artist';

      li.innerHTML = `
        <div class="track-info">
          <strong>${displayTitle}</strong>
          <span>${displayArtist}</span>
        </div>
        <div class="playlist-actions">
          <button class="remove-from-playlist-btn" data-index="${index}" title="Remove from Playlist">🗑️</button>
        </div>
      `;
      playlistList.appendChild(li);

      li.addEventListener('click', () => {
        currentTrackIndex = index;
        playCurrentTrack();
      });

      li.querySelector('.remove-from-playlist-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        const indexToRemove = parseInt(event.target.dataset.index);
        
        if (indexToRemove === currentTrackIndex) {
          pauseCurrentTrack();
          if (currentTrackType === 'youtube' && youtubePlayer) youtubePlayer.stopVideo();
          currentTrackIndex = -1;
          updateCurrentTrackInfo();
        } else if (indexToRemove < currentTrackIndex) {
          currentTrackIndex--;
        }
        playlist.splice(indexToRemove, 1);
        renderPlaylist();
      });
    });
  }

  /**
   * Shows the specified tab content and updates tab button active state.
   */
  function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');

    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${tabId}-btn`).classList.add('active');
  }

  /**
   * Clears any active library filter and displays all songs.
   */
  function clearFilter() {
    renderLibraryList('all');
  }
  
  /**
   * Validates URL input fields in real-time.
   * @param {HTMLInputElement} inputElement The input element to validate.
   * @param {RegExp} regex The regular expression to test against.
   */
  function validateUrlInput(inputElement, regex) {
      const url = inputElement.value.trim();
      if (url === '') {
          inputElement.classList.remove('valid', 'invalid');
          return;
      }
      if (regex.test(url)) {
          inputElement.classList.add('valid');
          inputElement.classList.remove('invalid');
      } else {
          inputElement.classList.add('invalid');
          inputElement.classList.remove('valid');
      }
  }

  // --- Event Listeners ---
  /**
   * Initializes all event listeners for player controls, inputs, and tabs.
   */
  function initEventListeners() {
    addMusicFileInput.addEventListener('change', (event) => addLocalFiles(event.target.files));

    playStreamBtn.addEventListener('click', () => {
      const url = streamUrlInput.value.trim();
      if (url) {
        const streamTrack = {
          id: Date.now() + Math.random(),
          name: url.split('/').pop() || 'Streaming Audio',
          url: url, type: 'stream', title: 'Streaming Audio', artist: 'Remote Stream', album: 'Live Stream'
        };
        playlist.push(streamTrack);
        currentTrackIndex = playlist.length - 1;
        playCurrentTrack();
        streamUrlInput.value = '';
        streamUrlInput.classList.remove('valid', 'invalid');
      } else {
        showUIMessage('Please enter a valid stream URL.', 'error');
      }
    });

    playYoutubeBtn.addEventListener('click', () => {
        const youtubeUrl = youtubeUrlInput.value.trim();
        const videoId = extractYouTubeVideoId(youtubeUrl);
        if (videoId) {
            const youtubeTrack = {
                id: videoId, url: youtubeUrl, videoId: videoId, type: 'youtube',
                title: 'YouTube Video', artist: 'YouTube', album: 'YouTube'
            };
            const existingIndex = playlist.findIndex(t => t.id === videoId);
            if (existingIndex === -1) {
                playlist.push(youtubeTrack);
                currentTrackIndex = playlist.length - 1;
            } else {
                currentTrackIndex = existingIndex;
            }
            playCurrentTrack();
            youtubeUrlInput.value = '';
            youtubeUrlInput.classList.remove('valid', 'invalid');
        } else {
            showUIMessage('Please enter a valid YouTube video URL.', 'error');
        }
    });

    addYoutubePlaylistBtn.addEventListener('click', () => {
        const playlistUrl = youtubePlaylistUrlInput.value.trim();
        const playlistId = extractYouTubePlaylistId(playlistUrl);
        if (playlistId) {
            addYouTubePlaylist(playlistId);
            youtubePlaylistUrlInput.value = '';
            youtubePlaylistUrlInput.classList.remove('valid', 'invalid');
        } else {
            showUIMessage('Please enter a valid YouTube playlist URL.', 'error');
        }
    });
    
    // Real-time URL validation
    const youtubeVideoRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}/;
    const youtubePlaylistRegex = /^(https?:\/\/)?(www\.)?youtube\.com\/playlist\?list=[a-zA-Z0-9_-]+/;
    const streamRegex = /^(https?:\/\/).*\.(mp3|aac|ogg|m4a)(\?.*)?$/i;

    youtubeUrlInput.addEventListener('input', () => validateUrlInput(youtubeUrlInput, youtubeVideoRegex));
    youtubePlaylistUrlInput.addEventListener('input', () => validateUrlInput(youtubePlaylistUrlInput, youtubePlaylistRegex));
    streamUrlInput.addEventListener('input', () => validateUrlInput(streamUrlInput, streamRegex));

    // Player controls
    playPauseBtn.addEventListener('click', togglePlayPause);
    prevBtn.addEventListener('click', playPrevTrack);
    nextBtn.addEventListener('click', playNextTrack);

    // Audio element events
    audio.addEventListener('timeupdate', updateProgressBarAndTimer);
    audio.addEventListener('ended', playNextTrack);
    audio.addEventListener('play', () => { isPlaying = true; updatePlayPauseButton(); updateMediaSession(); });
    audio.addEventListener('pause', () => { isPlaying = false; updatePlayPauseButton(); });
    audio.addEventListener('error', () => showUIMessage('Error playing audio file.', 'error'));

    volumeSlider.addEventListener('input', (event) => {
      const volume = event.target.value / 100;
      audio.volume = volume;
      if (youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
          youtubePlayer.setVolume(event.target.value);
      }
    });

    progressBarContainer.addEventListener('click', (event) => {
      const clickX = event.clientX - progressBarContainer.getBoundingClientRect().left;
      const percentage = clickX / progressBarContainer.offsetWidth;
      
      if (currentTrackType === 'youtube' && youtubePlayer && youtubePlayer.getDuration() > 0) {
          youtubePlayer.seekTo(youtubePlayer.getDuration() * percentage, true);
      } else if (audio && !isNaN(audio.duration) && audio.duration > 0) {
          audio.currentTime = audio.duration * percentage;
      }
    });

    // Tabs and filters
    libraryTabBtn.addEventListener('click', () => showTab('library-tab'));
    playlistTabBtn.addEventListener('click', () => showTab('playlist-tab'));
    viewAllSongsBtn.addEventListener('click', () => renderLibraryList('all'));
    viewAlbumsBtn.addEventListener('click', () => renderLibraryList('albums'));
    viewArtistsBtn.addEventListener('click', () => renderLibraryList('artists'));
    viewGenresBtn.addEventListener('click', () => renderLibraryList('genres'));
    clearFilterBtn.addEventListener('click', clearFilter);
  }

  // --- Initialization ---
  /**
   * Initializes the application.
   */
  async function init() {
    await openIndexedDB();
    await loadTracksFromIndexedDB();
    
    initEventListeners();
    setupMediaSessionHandlers();
    
    // Handle URL hash for PWA shortcuts
    const tab = window.location.hash.substring(1);
    if (tab === 'library') {
        showTab('library-tab');
    } else {
        showTab('playlist-tab');
    }

    renderPlaylist();
    renderLibraryList('all');
    setupVisualizer();
  }

  init();

  // Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then((reg) => console.log('Service Worker registered.', reg))
        .catch((err) => console.error('Service Worker registration failed:', err));
    });
  }
})(); // End of self-executing function
c
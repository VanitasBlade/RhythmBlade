import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════ */
const C = {
  bg:        "#110a28",
  bgCard:    "#1a1130",
  bgDeep:    "#0d0820",
  bgPlayer:  "#160e30",
  border:    "#2a2045",
  borderDim: "#1e1640",
  accent:    "#7c3aed",
  accentHi:  "#6d28d9",
  accentFg:  "#a78bfa",
  text:      "#d8d2f0",
  textDim:   "#8075a0",
  textMute:  "#4a4268",
  textDeep:  "#3d3560",
};

const ART = {
  purple: "#3b1f6e", pink: "#6b1444",
  blue:   "#163069", teal: "#0d4f47", red: "#6b1a1a",
};

/* ═══════════════════════════════════════════════════════════════
   ICONS
═══════════════════════════════════════════════════════════════ */
const Ico = {
  Home: ({ on }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z" fill={on ? C.accentFg : C.textMute}/>
      <rect x="9" y="13" width="6" height="8" rx="0.5" fill={on ? C.accent : "#2e2850"}/>
    </svg>
  ),
  Library: ({ on }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="4" height="18" rx="1" fill={on ? C.accentFg : C.textMute}/>
      <rect x="9" y="3" width="4" height="18" rx="1" fill={on ? C.accentFg : C.textMute}/>
      <path d="M15.5 3.5l5 17-3.9 1.1-5-17 3.9-1.1z" fill={on ? C.accentFg : C.textMute}/>
    </svg>
  ),
  Download: ({ on }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v13M7 12l5 5 5-5" stroke={on ? C.accentFg : C.textMute} strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter"/>
      <path d="M3 19h18" stroke={on ? C.accentFg : C.textMute} strokeWidth="2.2" strokeLinecap="square"/>
    </svg>
  ),
  Settings: ({ on }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 8a4 4 0 100 8 4 4 0 000-8z" fill={on ? C.accentFg : C.textMute}/>
      <path fillRule="evenodd" clipRule="evenodd" d="M9.93 2.19a1 1 0 011.14-.97l1.86.2a1 1 0 01.88.98v1.1a7.1 7.1 0 011.74 1l.95-.55a1 1 0 011.32.37l.93 1.61a1 1 0 01-.37 1.37l-.95.55a7.1 7.1 0 010 2l.95.55a1 1 0 01.37 1.37l-.93 1.61a1 1 0 01-1.32.37l-.95-.55a7.1 7.1 0 01-1.74 1v1.1a1 1 0 01-.88.98l-1.86.2a1 1 0 01-1.14-.97v-1.1a7.1 7.1 0 01-1.74-1l-.95.55a1 1 0 01-1.32-.37l-.93-1.61a1 1 0 01.37-1.37l.95-.55a7.1 7.1 0 010-2l-.95-.55a1 1 0 01-.37-1.37l.93-1.61a1 1 0 011.32-.37l.95.55a7.1 7.1 0 011.74-1V2.4a1 1 0 01.13-.21z"
        fill={on ? C.accent : "#2e2850"}/>
    </svg>
  ),
  More:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.8" fill={C.textMute}/><circle cx="12" cy="12" r="1.8" fill={C.textMute}/><circle cx="19" cy="12" r="1.8" fill={C.textMute}/></svg>,
  Prev:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M19 5L9 12l10 7V5z" fill={C.accentFg}/><rect x="5" y="5" width="2.5" height="14" rx="1" fill={C.accentFg}/></svg>,
  Next:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 5l10 7-10 7V5z" fill={C.accentFg}/><rect x="16.5" y="5" width="2.5" height="14" rx="1" fill={C.accentFg}/></svg>,
  Play:   () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 4l14 8-14 8V4z" fill={C.bg}/></svg>,
  Pause:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="4" width="4" height="16" rx="1" fill={C.bg}/><rect x="15" y="4" width="4" height="16" rx="1" fill={C.bg}/></svg>,
  Search: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={C.textMute} strokeWidth="2.2"/><path d="M17 17L22 22" stroke={C.textMute} strokeWidth="2.2" strokeLinecap="square"/></svg>,
  DlBtn:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3v13M7 12l5 5 5-5" stroke={C.bg} strokeWidth="2.4" strokeLinecap="square" strokeLinejoin="miter"/><path d="M4 19h16" stroke={C.bg} strokeWidth="2.4" strokeLinecap="square"/></svg>,
  Check:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 12l6 6L20 6" stroke={C.bg} strokeWidth="2.4" strokeLinecap="square" strokeLinejoin="miter"/></svg>,
  Back:   () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke={C.accentFg} strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter"/></svg>,
  Sort:   () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M6 12h12M10 18h4" stroke={C.textDim} strokeWidth="2" strokeLinecap="square"/></svg>,
  PlayAll:() => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 4l14 8-14 8V4z" fill={C.accentFg}/></svg>,
  Shuffle:() => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7" stroke={C.accentFg} strokeWidth="2" strokeLinecap="square"/><path d="M21 21h-5v-5M16 21l-7-7M3 3l7 7" stroke={C.accentFg} strokeWidth="2" strokeLinecap="square"/></svg>,
  Plus:   () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 4v16M4 12h16" stroke={C.bg} strokeWidth="2.5" strokeLinecap="square"/></svg>,
  Folder: ({ on }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill={on ? C.accentFg : C.textMute}/></svg>,
  Toggle: ({ on }) => <svg width="32" height="18" viewBox="0 0 32 18" fill="none"><rect width="32" height="18" rx="9" fill={on ? C.accent : C.border}/><circle cx={on ? 23 : 9} cy="9" r="6" fill={on ? "#fff" : C.textMute}/></svg>,
  File:   () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7z" fill={ART.purple}/><path d="M13 2v7h7" stroke={C.accentFg} strokeWidth="1.5" strokeLinecap="square"/><circle cx="10" cy="16" r="2" fill={C.accentFg}/><path d="M12 16V12l4-1" stroke={C.accentFg} strokeWidth="1.2" strokeLinecap="square"/></svg>,
  Camera: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="14" rx="2" fill={C.textMute}/><circle cx="12" cy="14" r="4" fill={C.textDeep}/><circle cx="12" cy="14" r="2.2" fill={C.textMute}/><path d="M8 7l1.5-3h5L16 7" fill={C.textMute}/></svg>,
  Path:   () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M2 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill={C.textMute}/></svg>,
  Quality:() => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke={C.textDim} strokeWidth="2" strokeLinecap="square"/><circle cx="6" cy="18" r="3" stroke={C.textDim} strokeWidth="2"/><circle cx="18" cy="16" r="3" stroke={C.textDim} strokeWidth="2"/></svg>,
  Bell:   () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke={C.textDim} strokeWidth="2" strokeLinecap="square"/></svg>,
  Equalizer: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 20V14M4 10V4M12 20V12M12 8V4M20 20V16M20 12V4M1 14h6M9 8h6M17 16h6" stroke={C.textDim} strokeWidth="2" strokeLinecap="square"/></svg>,
  ChevRight: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke={C.textMute} strokeWidth="2" strokeLinecap="square"/></svg>,
};

/* ═══════════════════════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════════════════════ */
const TRACKS = [
  { title: "Lost in the Echo", artist: "Linkin Park", c: "purple", emoji: "🌌", duration: 213, added: "2024-01-10" },
  { title: "Electric Feel",    artist: "MGMT",        c: "teal",   emoji: "⚡", duration: 249, added: "2024-01-08" },
  { title: "Back in Black",    artist: "AC/DC",       c: "red",    emoji: "🎸", duration: 255, added: "2024-01-05" },
  { title: "New Track",        artist: "Linkin Park", c: "purple", emoji: "🌌", duration: 187, added: "2024-01-03" },
  { title: "Synthwave Dream",  artist: "RetroWave",   c: "blue",   emoji: "🌊", duration: 252, added: "2023-12-28" },
  { title: "Indie Dreams",     artist: "Indie Band",  c: "pink",   emoji: "🎸", duration: 235, added: "2023-12-20" },
  { title: "Epic Orchestra",   artist: "Film Score",  c: "teal",   emoji: "🎻", duration: 321, added: "2023-12-15" },
  { title: "City Lights",      artist: "Urban Beats", c: "red",    emoji: "🌆", duration: 224, added: "2023-12-10" },
];

const SEARCH_RESULTS = [
  { title: "Synthwave Dream", artist: "RetroWave",   c: "blue",   emoji: "🌊", duration: "4:12" },
  { title: "Indie Dreams",    artist: "Indie Band",  c: "pink",   emoji: "🎸", duration: "3:55" },
  { title: "Top Hit Song",    artist: "Pop Singer",  c: "purple", emoji: "🎵", duration: "3:28" },
  { title: "Epic Orchestra",  artist: "Film Score",  c: "teal",   emoji: "🎻", duration: "5:21" },
  { title: "City Lights",     artist: "Urban Beats", c: "red",    emoji: "🌆", duration: "3:44" },
  { title: "Deep Forest",     artist: "Ambient Co",  c: "teal",   emoji: "🌿", duration: "6:02" },
];

const INIT_QUEUE = [
  { title: "Chill Groove Mix", artist: "DJ Relax",    c: "blue",   emoji: "🎧", progress: 45,  size: 4.6,  done: false },
  { title: "Neon Pulse",       artist: "SynthWave",   c: "purple", emoji: "🌌", progress: 12,  size: 3.8,  done: false },
  { title: "Acoustic Morning", artist: "Folk Studio", c: "pink",   emoji: "🎸", progress: 78,  size: 5.1,  done: false },
  { title: "Jazz Nights",      artist: "Blue Note",   c: "teal",   emoji: "🎷", progress: 100, size: 6.2,  done: true  },
];

const INIT_PLAYLISTS = [
  { name: "Favorites",      songs: 29, c: "pink",   emoji: "🩷" },
  { name: "Recently Added", songs: 12, c: "purple", emoji: "🎵" },
  { name: "Chill Vibes",    songs: 8,  c: "blue",   emoji: "🌆" },
  { name: "Workout Mix",    songs: 15, c: "red",    emoji: "💪" },
  { name: "Late Night",     songs: 22, c: "teal",   emoji: "🌙" },
  { name: "Road Trip",      songs: 31, c: "purple", emoji: "🚗" },
];

const INIT_SOURCES = [
  { path: "/Music/Downloads",  count: 142, on: true,  fmt: "MP3, FLAC" },
  { path: "/Music/iTunes",     count: 89,  on: true,  fmt: "MP3, AAC"  },
  { path: "/SD Card/Music",    count: 34,  on: false, fmt: "MP3"       },
  { path: "/Music/SoundCloud", count: 12,  on: true,  fmt: "MP3"       },
];

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ═══════════════════════════════════════════════════════════════
   SHARED PRIMITIVES
═══════════════════════════════════════════════════════════════ */
const Label = ({ children }) => (
  <p style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7, fontFamily: "'Outfit',sans-serif" }}>
    {children}
  </p>
);

const ArtBlock = ({ c, emoji, size = 54 }) => (
  <div style={{ width: size, height: size, flexShrink: 0, background: ART[c], display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4 }}>
    {emoji}
  </div>
);

const TrackRow = ({ title, artist, c, emoji, duration, right, onClick }) => (
  <div style={{ display: "flex", alignItems: "stretch", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", height: 54, flexShrink: 0, cursor: "pointer", transition: "background .12s" }}
    onClick={onClick}
    onMouseEnter={e => (e.currentTarget.style.background = "#211840")}
    onMouseLeave={e => (e.currentTarget.style.background = C.bgCard)}
  >
    <ArtBlock c={c} emoji={emoji} size={54} />
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 10px" }}>
      <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      <div style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>{artist}</div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 10 }}>
      {duration && <span style={{ fontSize: 10, color: C.textDeep, fontFamily: "'Outfit',sans-serif" }}>{typeof duration === "number" ? fmt(duration) : duration}</span>}
      {right || <Ico.More />}
    </div>
  </div>
);

const SubTabs = ({ tabs, active, onChange }) => (
  <div style={{ display: "flex", borderBottom: `1px solid ${C.borderDim}`, flexShrink: 0, margin: "0 16px" }}>
    {tabs.map(({ id, label, badge }) => {
      const on = active === id;
      return (
        <button key={id} onClick={() => onChange(id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "10px 0 9px", position: "relative", fontFamily: "'Outfit',sans-serif", fontSize: 12, fontWeight: on ? 600 : 400, color: on ? C.text : C.textMute, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "color .15s" }}>
          {label}
          {badge > 0 && <span style={{ background: C.accent, color: "#fff", fontSize: 9, fontWeight: 700, width: 15, height: 15, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>}
          {on && <div style={{ position: "absolute", bottom: -1, left: "20%", right: "20%", height: 2, background: C.accent }} />}
        </button>
      );
    })}
  </div>
);

const SearchBar = ({ value, onChange, placeholder = "Search..." }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, padding: "0 10px", height: 34 }}>
    <Ico.Search />
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "'Outfit',sans-serif", fontSize: 12, color: C.text }} />
  </div>
);

const Btn = ({ children, variant = "primary", style: s = {}, ...props }) => {
  const base = { display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 11, fontWeight: 600, border: "none", transition: "background .12s" };
  const styles = {
    primary: { background: C.accent, color: "#fff" },
    ghost:   { background: C.bgCard, border: `1px solid ${C.border}`, color: C.accentFg },
    dim:     { background: C.bgCard, border: `1px solid ${C.border}`, color: C.textDim },
  };
  const [hover, setHover] = useState(false);
  return (
    <button {...props} style={{ ...base, ...styles[variant], ...(hover && variant === "primary" ? { background: C.accentHi } : {}), ...s }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {children}
    </button>
  );
};

/* ════════════════════════════════════════════════════════════
   MINI PLAYER
════════════════════════════════════════════════════════════ */
const MiniPlayer = ({ track, playing, onToggle, onPrev, onNext }) => {
  const [progress, setProgress] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    clearInterval(ref.current);
    if (playing) ref.current = setInterval(() => setProgress(p => p >= track.duration ? 0 : p + 1), 1000);
    return () => clearInterval(ref.current);
  }, [playing, track]);

  useEffect(() => setProgress(0), [track]);

  const pct = (progress / track.duration) * 100;

  return (
    <div style={{ background: C.bgPlayer, borderTop: `1px solid ${C.border}`, position: "relative", padding: "8px 12px 10px", overflow: "hidden" }}>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: C.borderDim, cursor: "pointer" }}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setProgress(Math.round((e.clientX - r.left) / r.width * track.duration)); }}>
        <div style={{ width: `${pct}%`, height: "100%", background: C.accent, transition: "width .4s linear" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: 4, flexShrink: 0, background: ART[track.c], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{track.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
          <div style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>{track.artist}</div>
        </div>
        <div style={{ fontSize: 10, color: C.textMute, fontFamily: "'Outfit',sans-serif", whiteSpace: "nowrap" }}>{fmt(progress)} / {fmt(track.duration)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[{ icon: <Ico.Prev />, action: onPrev }, null, { icon: <Ico.Next />, action: onNext }].map((item, i) =>
            item === null ? (
              <button key={i} onClick={onToggle} style={{ width: 30, height: 30, borderRadius: "50%", background: C.accent, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {playing ? <Ico.Pause /> : <Ico.Play />}
              </button>
            ) : (
              <button key={i} onClick={item.action} style={{ background: "none", border: "none", cursor: "pointer", padding: 3, display: "flex", opacity: .8 }}
                onMouseEnter={e => (e.currentTarget.style.opacity = 1)} onMouseLeave={e => (e.currentTarget.style.opacity = .8)}>
                {item.icon}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════
   HOME TAB
════════════════════════════════════════════════════════════ */
const HomeTab = ({ onTrackClick }) => (
  <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 8px" }}>
    <section style={{ marginBottom: 20 }}>
      <Label>Continue Listening</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {TRACKS.slice(0, 3).map((t, i) => (
          <TrackRow key={i} {...t} onClick={() => onTrackClick(i)} />
        ))}
      </div>
    </section>
    <div style={{ height: 1, background: C.borderDim, marginBottom: 18 }} />
    <section>
      <Label>Your Playlists</Label>
      <div style={{ display: "flex", gap: 8 }}>
        {[{ name: "Favorites", songs: 29, c: "pink", emoji: "🩷" }, { name: "Recently Added", songs: 12, c: "purple", emoji: "🎵" }, { name: "Chill Vibes", songs: 8, c: "blue", emoji: "🌆" }].map((p, i) => (
          <div key={i} style={{ flex: 1, cursor: "pointer", textAlign: "center" }}
            onMouseEnter={e => e.currentTarget.querySelector(".cov").style.filter = "brightness(1.2)"}
            onMouseLeave={e => e.currentTarget.querySelector(".cov").style.filter = "brightness(1)"}>
            <div className="cov" style={{ height: 108, borderRadius: 6, background: ART[p.c], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 6, border: `1px solid rgba(255,255,255,.06)`, transition: "filter .15s" }}>{p.emoji}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#bdb5d8", fontFamily: "'Outfit',sans-serif" }}>{p.name}</div>
            <div style={{ fontSize: 10, color: C.textMute, marginTop: 1 }}>{p.songs} Songs</div>
          </div>
        ))}
      </div>
    </section>
  </div>
);

/* ════════════════════════════════════════════════════════════
   LIBRARY TAB
════════════════════════════════════════════════════════════ */
const LibTracksPanel = () => {
  const [sort, setSort] = useState("Name");
  const [sortOpen, setSortOpen] = useState(false);
  const opts = ["Name", "Artist", "Date Added"];
  const sorted = [...TRACKS].sort((a, b) =>
    sort === "Name" ? a.title.localeCompare(b.title) :
    sort === "Artist" ? a.artist.localeCompare(b.artist) :
    b.added.localeCompare(a.added)
  );
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px 6px", flexShrink: 0 }}>
        <Btn variant="primary"><Ico.PlayAll /> Play All</Btn>
        <Btn variant="ghost"><Ico.Shuffle /> Shuffle</Btn>
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <Btn variant="dim" onClick={() => setSortOpen(o => !o)}><Ico.Sort /> {sort}</Btn>
          {sortOpen && (
            <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 10, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", minWidth: 110 }}>
              {opts.map(o => (
                <button key={o} onClick={() => { setSort(o); setSortOpen(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: sort === o ? "#211840" : "none", border: "none", cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 11, color: sort === o ? C.accentFg : C.textDim }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#211840")} onMouseLeave={e => (e.currentTarget.style.background = sort === o ? "#211840" : "transparent")}>{o}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: "0 16px 5px", flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: C.textDeep, fontFamily: "'Outfit',sans-serif" }}>{sorted.length} tracks</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {sorted.map((t, i) => <TrackRow key={i} {...t} />)}
      </div>
    </div>
  );
};

const LibPlaylistsPanel = () => {
  const [search, setSearch] = useState("");
  const [lists, setLists] = useState(INIT_PLAYLISTS);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const colorKeys = Object.keys(ART);
  const filtered = lists.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  const rows = [];
  for (let i = 0; i < filtered.length; i += 2) rows.push(filtered.slice(i, i + 2));
  const create = () => {
    if (!newName.trim()) return;
    setLists(l => [...l, { name: newName.trim(), songs: 0, c: colorKeys[l.length % colorKeys.length], emoji: "🎵" }]);
    setNewName(""); setCreating(false);
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px 6px", flexShrink: 0, display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}><SearchBar value={search} onChange={setSearch} placeholder="Search playlists..." /></div>
        <button onClick={() => setCreating(c => !c)} style={{ width: 34, height: 34, borderRadius: 4, background: C.accent, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <Ico.Plus />
        </button>
      </div>
      {creating && (
        <div style={{ padding: "0 16px 8px", display: "flex", gap: 6, flexShrink: 0 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} placeholder="Playlist name..." autoFocus
            style={{ flex: 1, background: C.bgCard, border: `1px solid ${C.accent}`, borderRadius: 6, padding: "6px 10px", outline: "none", fontFamily: "'Outfit',sans-serif", fontSize: 12, color: C.text }} />
          <Btn variant="primary" onClick={create}>Create</Btn>
        </div>
      )}
      <div style={{ padding: "0 16px 4px", flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: C.textDeep, fontFamily: "'Outfit',sans-serif" }}>{filtered.length} playlists</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 8px" }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {row.map((pl, pi) => (
              <div key={pi} style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
                onMouseEnter={e => e.currentTarget.querySelector(".pc").style.filter = "brightness(1.2)"}
                onMouseLeave={e => e.currentTarget.querySelector(".pc").style.filter = "brightness(1)"}>
                <div className="pc" style={{ height: 110, borderRadius: 6, background: ART[pl.c], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, border: `1px solid rgba(255,255,255,.06)`, transition: "filter .15s", marginBottom: 6 }}>{pl.emoji}</div>
                <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 11, color: "#bdb5d8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.name}</div>
                <div style={{ fontSize: 10, color: C.textMute, marginTop: 1 }}>{pl.songs} Songs</div>
              </div>
            ))}
            {row.length === 1 && <div style={{ flex: 1 }} />}
          </div>
        ))}
      </div>
    </div>
  );
};

const LibFilesPanel = () => {
  const [sources, setSources] = useState(INIT_SOURCES);
  const toggle = i => setSources(s => s.map((x, idx) => idx === i ? { ...x, on: !x.on } : x));
  const total = sources.filter(s => s.on).reduce((a, s) => a + s.count, 0);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px 6px", flexShrink: 0 }}>
        <Label>File Sources</Label>
        <span style={{ fontSize: 10, color: C.textDeep, fontFamily: "'Outfit',sans-serif" }}>{total} files · {sources.filter(s => s.on).length} active sources</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 16px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
        {sources.map((src, i) => (
          <div key={i} style={{ background: C.bgCard, border: `1px solid ${src.on ? C.border : C.borderDim}`, borderRadius: 6, overflow: "hidden", display: "flex" }}>
            <div style={{ width: 3, background: src.on ? C.accent : C.border, transition: "background .3s" }} />
            <div style={{ flex: 1, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <Ico.Folder on={src.on} />
                <span style={{ flex: 1, fontFamily: "'Outfit',sans-serif", fontSize: 11, fontWeight: 600, color: src.on ? C.text : C.textMute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color .2s" }}>{src.path}</span>
                <button onClick={() => toggle(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><Ico.Toggle on={src.on} /></button>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Ico.File />
                  <span style={{ fontSize: 10, fontFamily: "'Outfit',sans-serif", color: C.textDim }}>{src.count} files</span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {src.fmt.split(", ").map(f => (
                    <span key={f} style={{ fontSize: 9, fontFamily: "'Outfit',sans-serif", fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: C.border, color: src.on ? C.accentFg : C.textDeep, letterSpacing: ".04em" }}>{f}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
        <button style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 10, borderRadius: 6, background: "none", border: `1px dashed ${C.border}`, cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 11, color: C.textMute, transition: "border-color .15s" }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)} onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
          ＋ Add file source
        </button>
      </div>
    </div>
  );
};

const LibraryTab = () => {
  const [sub, setSub] = useState("tracks");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <SubTabs tabs={[{ id: "tracks", label: "Tracks" }, { id: "playlists", label: "Playlists" }, { id: "files", label: "Files" }]} active={sub} onChange={setSub} />
      {sub === "tracks"    && <LibTracksPanel />}
      {sub === "playlists" && <LibPlaylistsPanel />}
      {sub === "files"     && <LibFilesPanel />}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════
   DOWNLOADER TAB
════════════════════════════════════════════════════════════ */
const DlSearchPanel = ({ queue, onAdd }) => {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Tracks");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px 8px", flexShrink: 0 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search songs, albums, artists..." />
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {["Tracks", "Albums", "Artists", "Playlists"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ flex: 1, padding: "5px 0", borderRadius: 4, background: filter === f ? C.accent : C.bgCard, border: `1px solid ${filter === f ? C.accent : C.border}`, color: filter === f ? "#fff" : C.textMute, fontFamily: "'Outfit',sans-serif", fontWeight: filter === f ? 600 : 400, fontSize: 11, cursor: "pointer", transition: "all .15s" }}>{f}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {SEARCH_RESULTS.map((r, i) => {
          const queued = !!queue.find(q => q.title === r.title);
          return (
            <TrackRow key={i} {...r}
              right={
                <button onClick={() => onAdd(r)} style={{ width: 28, height: 28, borderRadius: 4, background: queued ? C.border : C.accent, border: queued ? `1px solid ${C.textDeep}` : "none", cursor: queued ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s" }}
                  onMouseEnter={e => { if (!queued) e.currentTarget.style.background = C.accentHi; }}
                  onMouseLeave={e => { if (!queued) e.currentTarget.style.background = C.accent; }}>
                  {queued ? <Ico.Check /> : <Ico.DlBtn />}
                </button>
              }
            />
          );
        })}
      </div>
    </div>
  );
};

const DlQueuePanel = ({ queue }) => (
  <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
    {queue.length === 0 && (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 60 }}>
        <Ico.Download on={false} />
        <span style={{ color: C.textDeep, fontFamily: "'Outfit',sans-serif", fontSize: 12 }}>Queue is empty</span>
      </div>
    )}
    {queue.map((item, i) => (
      <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", display: "flex", height: 60 }}>
        <div style={{ width: 3, background: item.done ? C.textDeep : C.accent, transition: "background .4s" }} />
        <div style={{ width: 52, background: ART[item.c], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{item.emoji}</div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
            <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{item.title}</div>
            <span style={{ fontSize: 10, fontFamily: "'Outfit',sans-serif", color: item.done ? C.accentFg : C.accent, flexShrink: 0, marginLeft: 4 }}>{item.done ? "✓ Done" : `${item.progress}%`}</span>
          </div>
          <div style={{ height: 2, background: C.border }}>
            <div style={{ width: `${item.progress}%`, height: "100%", background: item.done ? C.textDeep : C.accent, transition: "width .35s linear" }} />
          </div>
          <div style={{ fontSize: 9, color: C.textDeep, marginTop: 4, fontFamily: "'Outfit',sans-serif" }}>
            {item.done ? `${item.size} MB` : `${(item.size * item.progress / 100).toFixed(1)} MB / ${item.size} MB`}
          </div>
        </div>
      </div>
    ))}
  </div>
);

const DownloaderTab = () => {
  const [sub, setSub] = useState("search");
  const [queue, setQueue] = useState(INIT_QUEUE);
  useEffect(() => {
    const id = setInterval(() => setQueue(q => q.map(item => item.done || item.progress >= 100 ? { ...item, progress: 100, done: true } : { ...item, progress: item.progress + 1 })), 400);
    return () => clearInterval(id);
  }, []);
  const addToQueue = useCallback((track) => {
    setQueue(q => q.find(x => x.title === track.title) ? q : [...q, { ...track, progress: 0, done: false }]);
    setSub("queue");
  }, []);
  const active = queue.filter(q => !q.done).length;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <SubTabs tabs={[{ id: "search", label: "Search" }, { id: "queue", label: "Queue", badge: active }]} active={sub} onChange={setSub} />
      {sub === "search" && <DlSearchPanel queue={queue} onAdd={addToQueue} />}
      {sub === "queue"  && <DlQueuePanel queue={queue} />}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════
   SETTINGS TAB
════════════════════════════════════════════════════════════ */
const SettingsSection = ({ title, children }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ padding: "0 16px 6px" }}>
      <Label>{title}</Label>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {children}
    </div>
  </div>
);

const SettingsRow = ({ icon, label, sub, right, onClick }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: C.bgCard, borderTop: `1px solid ${C.borderDim}`, cursor: onClick ? "pointer" : "default", transition: "background .12s" }}
    onClick={onClick}
    onMouseEnter={e => { if (onClick) e.currentTarget.style.background = "#211840"; }}
    onMouseLeave={e => { if (onClick) e.currentTarget.style.background = C.bgCard; }}>
    <div style={{ width: 28, height: 28, borderRadius: 5, background: C.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 12, color: C.text }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.textMute, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
    {right}
    {onClick && !right && <Ico.ChevRight />}
  </div>
);

const SettingsTab = ({ avatar, onAvatarChange }) => {
  const [dlPath, setDlPath]         = useState("/Music/Downloads");
  const [editPath, setEditPath]     = useState(false);
  const [quality, setQuality]       = useState("320 kbps");
  const [qualOpen, setQualOpen]     = useState(false);
  const [notifications, setNotifs]  = useState(true);
  const [autoPlay, setAutoPlay]     = useState(true);
  const [crossfade, setCrossfade]   = useState(false);
  const [normalize, setNormalize]   = useState(true);
  const [darkMode, setDarkMode]     = useState(true);
  const fileRef = useRef(null);
  const qualities = ["128 kbps", "192 kbps", "256 kbps", "320 kbps", "FLAC"];

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingTop: 10, paddingBottom: 8 }}>

      {/* ── Profile ── */}
      <SettingsSection title="Profile">
        <div style={{ padding: "12px 16px 16px", background: C.bgCard, borderTop: `1px solid ${C.borderDim}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Avatar */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: ART.purple, border: `2px solid ${C.accent}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {avatar
                  ? <img src={avatar} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 28 }}>👤</span>}
              </div>
              {/* Upload overlay */}
              <button onClick={() => fileRef.current.click()} style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(0,0,0,0.55)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity .15s" }}
                onMouseEnter={e => (e.currentTarget.style.opacity = 1)} onMouseLeave={e => (e.currentTarget.style.opacity = 0)}>
                <Ico.Camera />
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = ev => onAvatarChange(ev.target.result); r.readAsDataURL(f); } }} />
            </div>
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 14, color: C.text }}>Your Profile</div>
              <div style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>Tap photo to change</div>
              <button onClick={() => fileRef.current.click()} style={{ marginTop: 8, padding: "4px 10px", borderRadius: 4, background: "none", border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 10, color: C.accentFg, transition: "border-color .15s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)} onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
                Upload Photo
              </button>
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* ── Downloads ── */}
      <SettingsSection title="Downloads">
        <div style={{ background: C.bgCard, borderTop: `1px solid ${C.borderDim}`, padding: "10px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 5, background: C.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ico.Path /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 12, color: C.text }}>Save Location</div>
              <div style={{ fontSize: 10, color: C.textMute, marginTop: 1 }}>Where downloaded songs are saved</div>
            </div>
          </div>
          {editPath ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input value={dlPath} onChange={e => setDlPath(e.target.value)} autoFocus
                style={{ flex: 1, background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 5, padding: "6px 10px", outline: "none", fontFamily: "'Outfit',sans-serif", fontSize: 11, color: C.text }} />
              <Btn variant="primary" onClick={() => setEditPath(false)}>Save</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, borderRadius: 5, padding: "6px 10px", border: `1px solid ${C.borderDim}` }}>
              <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 11, color: C.textDim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dlPath}</span>
              <button onClick={() => setEditPath(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 10, color: C.accentFg, flexShrink: 0, marginLeft: 8 }}>Change</button>
            </div>
          )}
        </div>

        {/* Quality */}
        <div style={{ background: C.bgCard, borderTop: `1px solid ${C.borderDim}`, padding: "10px 16px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 5, background: C.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ico.Quality /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 12, color: C.text }}>Download Quality</div>
              <div style={{ fontSize: 10, color: C.textMute, marginTop: 1 }}>Audio bitrate for downloads</div>
            </div>
            <button onClick={() => setQualOpen(o => !o)} style={{ padding: "4px 10px", borderRadius: 4, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 11, color: C.accentFg, transition: "border-color .15s" }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)} onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
              {quality}
            </button>
          </div>
          {qualOpen && (
            <div style={{ position: "absolute", right: 16, top: "110%", zIndex: 10, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", minWidth: 120 }}>
              {qualities.map(q => (
                <button key={q} onClick={() => { setQuality(q); setQualOpen(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: quality === q ? "#211840" : "none", border: "none", cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 11, color: quality === q ? C.accentFg : C.textDim }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#211840")} onMouseLeave={e => (e.currentTarget.style.background = quality === q ? "#211840" : "transparent")}>
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      {/* ── Playback ── */}
      <SettingsSection title="Playback">
        <SettingsRow icon={<Ico.PlayAll />} label="Auto-play" sub="Continue playing after queue ends"
          right={<button onClick={() => setAutoPlay(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><Ico.Toggle on={autoPlay} /></button>} />
        <SettingsRow icon={<Ico.Equalizer />} label="Normalize Volume" sub="Balance loudness across tracks"
          right={<button onClick={() => setNormalize(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><Ico.Toggle on={normalize} /></button>} />
        <SettingsRow icon={<Ico.Shuffle />} label="Crossfade" sub="Smooth transition between tracks"
          right={<button onClick={() => setCrossfade(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><Ico.Toggle on={crossfade} /></button>} />
      </SettingsSection>

      {/* ── App ── */}
      <SettingsSection title="App">
        <SettingsRow icon={<Ico.Bell />} label="Notifications" sub="Download complete alerts"
          right={<button onClick={() => setNotifs(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><Ico.Toggle on={notifications} /></button>} />
        <SettingsRow icon={<Ico.Settings on={false} />} label="Dark Mode" sub="Always on"
          right={<button style={{ background: "none", border: "none", cursor: "default", padding: 0 }}><Ico.Toggle on={darkMode} /></button>} />
      </SettingsSection>

      {/* ── About ── */}
      <SettingsSection title="About">
        <SettingsRow icon={<Ico.File />} label="Version" sub="1.0.0 — Build 42" />
        <SettingsRow icon={<Ico.Quality />} label="Supported Formats" sub="MP3 · FLAC · AAC · OGG · WAV" />
        <SettingsRow icon={<Ico.Folder on={false} />} label="Clear Cache" sub="Frees up temporary files" onClick={() => {}} />
      </SettingsSection>

    </div>
  );
};

/* ════════════════════════════════════════════════════════════
   ROOT APP
════════════════════════════════════════════════════════════ */
const TABS = [
  { id: "home",     label: "Home",       Icon: Ico.Home },
  { id: "library",  label: "Library",    Icon: Ico.Library },
  { id: "download", label: "Downloader", Icon: Ico.Download },
  { id: "settings", label: "Settings",   Icon: Ico.Settings },
];

export default function MusicApp() {
  const [tab, setTab]           = useState("home");
  const [trackIdx, setTrackIdx] = useState(0);
  const [playing, setPlaying]   = useState(false);
  const [avatar, setAvatar]     = useState(null);

  const playTrack = i => { if (trackIdx === i) setPlaying(p => !p); else { setTrackIdx(i); setPlaying(true); } };

  const HEADERS = { home: "Home", library: "Library", download: "Downloader", settings: "Settings" };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #2e2060; }
        input::placeholder { color: ${C.textMute}; }
      `}</style>

      {/* Outer rim */}
      <div style={{ width: 340, height: 700, borderRadius: 10, padding: "1.5px", background: "linear-gradient(160deg, rgba(140,110,220,.55) 0%, rgba(80,55,150,.3) 50%, rgba(140,110,220,.45) 100%)", boxShadow: "0 20px 60px rgba(0,0,0,.9)" }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 9, background: C.bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "44px 16px 10px", borderBottom: `1px solid ${C.borderDim}`, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {tab !== "home" && (
                <button onClick={() => setTab("home")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><Ico.Back /></button>
              )}
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e8e2f8", fontFamily: "'Outfit',sans-serif", letterSpacing: "-.2px" }}>{HEADERS[tab]}</h1>
            </div>
            {tab === "home" && (
              <button onClick={() => setTab("settings")} title="Profile" style={{ width: 30, height: 30, borderRadius: "50%", padding: 0, border: `1.5px solid #6d4aad`, overflow: "hidden", background: ART.purple, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "border-color .15s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = C.accentFg)} onMouseLeave={e => (e.currentTarget.style.borderColor = "#6d4aad")}>
                {avatar
                  ? <img src={avatar} alt="User" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                  : <span style={{ fontSize: 14 }}>👤</span>}
              </button>
            )}
          </div>

          {/* Tab content */}
          {tab === "home"     && <HomeTab onTrackClick={playTrack} />}
          {tab === "library"  && <LibraryTab />}
          {tab === "download" && <DownloaderTab />}
          {tab === "settings" && <SettingsTab avatar={avatar} onAvatarChange={setAvatar} />}

          {/* Mini player */}
          <MiniPlayer track={TRACKS[trackIdx]} playing={playing}
            onToggle={() => setPlaying(p => !p)}
            onPrev={() => { setTrackIdx(i => (i - 1 + TRACKS.length) % TRACKS.length); setPlaying(true); }}
            onNext={() => { setTrackIdx(i => (i + 1) % TRACKS.length); setPlaying(true); }} />

          {/* Nav */}
          <div style={{ display: "flex", background: C.bgDeep, borderTop: `1px solid ${C.borderDim}`, padding: "8px 0 18px", flexShrink: 0 }}>
            {TABS.map(({ id, label, Icon }) => {
              const on = tab === id;
              return (
                <button key={id} onClick={() => setTab(id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
                  <Icon on={on} />
                  <span style={{ fontSize: 10, fontFamily: "'Outfit',sans-serif", fontWeight: on ? 600 : 400, color: on ? C.accentFg : C.textDeep, transition: "color .15s" }}>{label}</span>
                </button>
              );
            })}
          </div>

        </div>
      </div>
    </>
  );
}

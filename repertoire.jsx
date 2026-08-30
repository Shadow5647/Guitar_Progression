import React, { useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------
   DATA ACCESS LAYER
   Every component talks to songRepo — never to storage directly.
   To move to Supabase later, rewrite the methods below. Nothing else changes.
------------------------------------------------------------------- */

const KEY = "repertoire:songs";

async function readAll() {
  try {
    const res = await window.storage.get(KEY);
    return res ? JSON.parse(res.value) : [];
  } catch {
    return [];
  }
}

async function writeAll(songs) {
  try {
    await window.storage.set(KEY, JSON.stringify(songs));
  } catch (e) {
    console.error("Could not save:", e);
  }
}

const songRepo = {
  getAll: () => readAll(),
  async create(fields) {
    const songs = await readAll();
    const song = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...fields };
    const next = [song, ...songs];
    await writeAll(next);
    return next;
  },
  async update(id, patch) {
    const next = (await readAll()).map((s) => (s.id === id ? { ...s, ...patch } : s));
    await writeAll(next);
    return next;
  },
  async remove(id) {
    const next = (await readAll()).filter((s) => s.id !== id);
    await writeAll(next);
    return next;
  },
};

/* ------------------------------------------------------------------ */

const STATUSES = [
  { id: "queued", label: "Queued", fret: 0 },
  { id: "learning", label: "Learning", fret: 1 },
  { id: "rough", label: "Rough", fret: 2 },
  { id: "can_play", label: "Can play", fret: 3 },
  { id: "solid", label: "Solid", fret: 4 },
  { id: "polished", label: "Polished", fret: 5 },
];

const STYLES = [
  { id: "solo", label: "Solo" },
  { id: "strumming", label: "Strumming" },
  { id: "both", label: "Both" },
];

const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
const styleOf = (id) => STYLES.find((s) => s.id === id) || STYLES[1];
const PROGRESS_FILTER_OPTIONS = [...STATUSES].reverse();

const FRET_WIRES = [4, 27, 50, 73, 96, 119, 142];
const FRET_CENTERS = [15.5, 38.5, 61.5, 84.5, 107.5, 130.5];
const FRET_VIEWBOX_W = 146;

/* Signature element: a six-fret neck. The inlay dot sits at the fret
   matching the song's progress. Read-only here — progress is edited
   via the slider in the add/edit panel. */
function FretMarker({ status }) {
  const active = statusOf(status);
  return (
    <div className="fret" aria-label={`Progress: ${active.label}`}>
      <span className="fret-label">{active.label}</span>
      <svg viewBox={`0 0 ${FRET_VIEWBOX_W} 22`} width={FRET_VIEWBOX_W} height="22" aria-hidden="true">
        <rect x="0" y="1" width="3.5" height="20" fill="var(--bone)" />
        {FRET_WIRES.slice(1).map((x) => (
          <rect key={x} x={x} y="2" width="1" height="18" fill="var(--line)" />
        ))}
        <rect x="4" y="7" width={FRET_WIRES[FRET_WIRES.length - 1] - 4} height="0.75" fill="var(--line)" />
        <rect x="4" y="14.5" width={FRET_WIRES[FRET_WIRES.length - 1] - 4} height="0.75" fill="var(--line)" />
        <circle cx={FRET_CENTERS[active.fret]} cy="11" r="4.2" fill="var(--brass)" />
      </svg>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, onEnter, inputRef }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        ref={inputRef}
        className={mono ? "input mono" : "input"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
      />
    </label>
  );
}

const blankDraft = () => ({
  title: "",
  artist: "",
  songKey: "",
  capo: "",
  tuning: "",
  chords: [""],
  status: "queued",
  style: "strumming",
});

export default function Repertoire() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [artistFilter, setArtistFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [draft, setDraft] = useState(blankDraft());
  const [pendingRemove, setPendingRemove] = useState(null);
  const [artistSuggestOpen, setArtistSuggestOpen] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    songRepo.getAll().then((s) => {
      setSongs(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const onDocClick = (e) => {
      if (artistSuggestOpen && !e.target.closest(".autocomplete")) setArtistSuggestOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [artistSuggestOpen]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (artistSuggestOpen) { setArtistSuggestOpen(false); return; }
      if (pendingRemove) { setPendingRemove(null); return; }
      if (open) closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Lock background scroll (iOS-safe) and keep the modal pinned/centered while it's open.
  useEffect(() => {
    const modalOpen = open || !!pendingRemove;
    if (!modalOpen) return;
    const scrollY = window.scrollY;
    const { style } = document.body;
    const prev = { position: style.position, top: style.top, width: style.width, overflow: style.overflow };
    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.width = "100%";
    style.overflow = "hidden";
    return () => {
      style.position = prev.position;
      style.top = prev.top;
      style.width = prev.width;
      style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open, pendingRemove]);

  const distinctArtists = useMemo(() => {
    const seen = new Set();
    const out = [];
    songs.forEach((s) => {
      const a = (s.artist || "").trim();
      if (a && !seen.has(a.toLowerCase())) {
        seen.add(a.toLowerCase());
        out.push(a);
      }
    });
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [songs]);

  const artistMatches = useMemo(() => {
    const q = draft.artist.trim().toLowerCase();
    return q ? distinctArtists.filter((a) => a.toLowerCase().includes(q)) : distinctArtists;
  }, [draft.artist, distinctArtists]);

  const openAdd = () => {
    setEditingId(null);
    setDraft(blankDraft());
    setOpen(true);
  };

  const openEdit = (song) => {
    setEditingId(song.id);
    setDraft({
      title: song.title || "",
      artist: song.artist || "",
      songKey: song.songKey || "",
      capo: song.capo || "",
      tuning: song.tuning || "",
      chords: song.chords && song.chords.length ? song.chords : [""],
      status: song.status || "queued",
      style: song.style || "strumming",
    });
    setOpen(true);
  };

  function closePanel() {
    setOpen(false);
    setEditingId(null);
    setArtistSuggestOpen(false);
  }

  const submit = async () => {
    if (!draft.title.trim()) {
      titleRef.current && titleRef.current.focus();
      return;
    }
    const payload = {
      title: draft.title.trim(),
      artist: draft.artist.trim(),
      songKey: draft.songKey.trim(),
      capo: draft.capo.trim(),
      tuning: draft.tuning.trim() || "Standard",
      chords: draft.chords.map((c) => c.trim()).filter(Boolean),
      status: draft.status,
      style: draft.style,
    };
    setSongs(editingId ? await songRepo.update(editingId, payload) : await songRepo.create(payload));
    closePanel();
  };

  const requestRemove = (song) => setPendingRemove(song);
  const cancelRemove = () => setPendingRemove(null);
  const confirmRemove = async () => {
    const id = pendingRemove.id;
    setSongs(await songRepo.remove(id));
    setPendingRemove(null);
    if (editingId === id) closePanel();
  };

  const setField = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const setChord = (i, v) =>
    setDraft((d) => {
      const chords = d.chords.slice();
      chords[i] = v;
      return { ...d, chords };
    });
  const addChordField = () => setDraft((d) => ({ ...d, chords: [...d.chords, ""] }));
  const removeChordField = (i) =>
    setDraft((d) => ({ ...d, chords: d.chords.filter((_, idx) => idx !== i) }));

  const shown = songs
    .filter((s) => !artistFilter || s.artist === artistFilter)
    .filter((s) => !statusFilter || s.status === statusFilter)
    .sort((a, b) => statusOf(b.status).fret - statusOf(a.status).fret);

  return (
    <div className="wrap">
      <style>{`
        .wrap {
          --stage:#14171F; --panel:#1D2230; --panel-2:#242A3A; --line:#2C3446;
          --bone:#E7E4DA; --muted:#8890A3; --faint:#4C5568;
          --brass:#D6A94A; --brass-dim:#8A712F; --danger:#C4644F;
        }
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

        .wrap {
          background: var(--stage); color: var(--bone);
          font-family: 'Barlow', system-ui, sans-serif;
          min-height: 100%;
          padding: calc(env(safe-area-inset-top, 0px) + 28px)
                   calc(env(safe-area-inset-right, 0px) + 18px)
                   calc(env(safe-area-inset-bottom, 0px) + 72px)
                   calc(env(safe-area-inset-left, 0px) + 18px);
        }
        .wrap * { box-sizing: border-box; }
        .inner { max-width: 640px; margin: 0 auto; }

        .masthead {
          display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
          border-top: 1px solid var(--brass); border-bottom: 1px solid var(--brass);
          padding: 13px 0 11px;
        }
        .masthead h1 {
          font-family: 'Barlow Condensed', sans-serif; font-weight: 600;
          font-size: 30px; letter-spacing: .13em; text-transform: uppercase;
          margin: 0; line-height: 1; text-wrap: balance;
        }
        .count {
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          color: var(--brass); letter-spacing: .07em; font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 18px 0 16px; }
        .spacer { flex: 1; }

        .select-chip {
          font-family: 'Barlow', system-ui, sans-serif; font-size: 16px;
          background: var(--stage); border: 1px solid var(--line); color: var(--muted);
          padding: 8px 10px; border-radius: 2px; cursor: pointer; max-width: 200px;
        }
        .select-chip:hover { color: var(--bone); border-color: var(--muted); }

        .add-label-short { display: none; }

        .primary {
          font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 14px;
          letter-spacing: .11em; text-transform: uppercase;
          background: none; border: 1px solid var(--brass); color: var(--brass);
          padding: 10px 18px; border-radius: 2px; cursor: pointer;
        }
        .primary:hover { background: var(--brass); color: var(--stage); }
        .primary.solid { background: var(--brass); color: var(--stage); }
        .primary.solid:hover { filter: brightness(1.1); }
        .ghost {
          font-family: 'Barlow Condensed', sans-serif; font-weight: 500; font-size: 14px;
          letter-spacing: .11em; text-transform: uppercase;
          background: none; border: none; color: var(--muted); cursor: pointer; padding: 10px 4px;
        }
        .ghost:hover { color: var(--bone); }

        .chip {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .05em;
          background: none; border: 1px solid var(--line); color: var(--muted);
          padding: 8px 12px; border-radius: 2px; cursor: pointer;
        }
        .chip:hover { color: var(--bone); border-color: var(--muted); }
        .chip.on { color: var(--stage); background: var(--brass); border-color: var(--brass); }

        .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 18px; margin-bottom: 20px; }
        .panel-heading {
          font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 14px;
          letter-spacing: .11em; text-transform: uppercase; color: var(--brass); margin: 0;
        }
        .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field-label {
          font-family: 'JetBrains Mono', monospace; font-size: 10px;
          letter-spacing: .13em; text-transform: uppercase; color: var(--muted);
        }
        .input {
          background: var(--panel-2); border: none; border-bottom: 1px solid var(--line);
          color: var(--bone); font-family: 'Barlow', sans-serif; font-size: 16px;
          padding: 8px 8px; outline: none; width: 100%; border-radius: 2px 2px 0 0;
        }
        .input.mono { font-family: 'JetBrains Mono', monospace; font-size: 16px; }
        .input:focus { border-bottom-color: var(--brass); }
        .input::placeholder { color: var(--faint); }
        .actions { display: flex; gap: 10px; align-items: center; margin-top: 20px; }

        .triple { display: flex; gap: 14px; }
        .triple .field { flex: 1; min-width: 0; }

        .autocomplete { position: relative; }
        .ac-list {
          display: none; position: absolute; left: 0; right: 0; top: 100%; margin-top: 4px;
          background: var(--panel-2); border: 1px solid var(--line); border-radius: 2px;
          max-height: 170px; overflow-y: auto; z-index: 30;
          box-shadow: 0 10px 28px rgba(0,0,0,.45);
        }
        .ac-list.open { display: block; }
        .ac-item { padding: 9px 11px; font-size: 14px; color: var(--bone); cursor: pointer; }
        .ac-item:hover { background: var(--panel); }

        .chip-row { display: flex; flex-wrap: wrap; gap: 8px; }

        .progress-slider { display: flex; flex-direction: column; gap: 6px; }
        .progress-slider input[type="range"] {
          width: 100%; accent-color: var(--brass); background: transparent; height: 22px; cursor: pointer;
        }
        .progress-ticks { display: flex; justify-content: space-between; padding: 0 3px; }
        .progress-tick {
          width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--line);
          background: var(--panel-2);
        }
        .progress-tick.on { background: var(--brass); border-color: var(--brass); }
        .progress-current {
          font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: .08em;
          text-transform: uppercase; color: var(--brass); margin-top: 6px;
        }

        .chords-wrap { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .chord-field {
          display: flex; align-items: center; gap: 2px;
          background: var(--panel-2); border-bottom: 1px solid var(--line); border-radius: 2px 2px 0 0;
          padding: 0 4px 0 8px;
        }
        .chord-field:focus-within { border-bottom-color: var(--brass); }
        .chord-field input {
          border: none; background: none; color: var(--bone);
          font-family: 'JetBrains Mono', monospace; font-size: 16px;
          padding: 8px 2px; width: 68px; outline: none;
        }
        .chord-field input::placeholder { color: var(--faint); }
        .chord-remove {
          background: none; border: none; color: var(--faint); cursor: pointer;
          font-size: 15px; line-height: 1; padding: 4px;
        }
        .chord-remove:hover { color: var(--danger); }
        .chord-add {
          font-family: 'JetBrains Mono', monospace; font-size: 17px; line-height: 1;
          background: none; border: 1px dashed var(--line); color: var(--muted);
          border-radius: 2px; width: 37px; height: 37px;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
        }
        .chord-add:hover { color: var(--bone); border-color: var(--muted); }

        .row {
          display: flex; align-items: flex-start; gap: 14px;
          padding: 15px 0; border-bottom: 1px solid var(--line);
          cursor: pointer;
        }
        .row:first-child { border-top: 1px solid var(--line); }
        .row:hover { background: var(--panel-2); }
        .meat { flex: 1; min-width: 0; }
        .title { font-size: 17px; font-weight: 500; text-wrap: balance; padding-top: 3px; }
        .artist { color: var(--muted); font-weight: 400; font-size: 15px; }
        .chordline { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .chords-line { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .chord {
          font-family: 'JetBrains Mono', monospace; font-size: 11px;
          border: 1px solid var(--line); color: var(--bone);
          padding: 2px 6px; border-radius: 2px;
        }
        .meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); letter-spacing: .03em; }

        .tag {
          font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .06em;
          text-transform: uppercase; border: 1px solid var(--line); color: var(--muted);
          padding: 3px 8px; border-radius: 2px;
        }

        .side { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }

        .fret { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px; }
        .fret-label {
          font-family: 'JetBrains Mono', monospace; font-size: 9px;
          letter-spacing: .09em; text-transform: uppercase; color: var(--muted);
        }

        .empty { border: 1px dashed var(--line); border-radius: 3px; padding: 42px 20px; text-align: center; }
        .empty p { color: var(--muted); margin: 0 0 6px; }
        .empty .hint { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--faint); letter-spacing: .05em; }

        .overlay {
          position: fixed; inset: 0; background: rgba(10,12,17,.72);
          align-items: center; justify-content: center; padding: 20px; z-index: 50;
          display: flex; overscroll-behavior: contain;
        }
        .overlay .panel { max-width: 440px; width: 100%; max-height: 85vh; overflow-y: auto; margin-bottom: 0; }
        .modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
        .modal-close {
          background: none; border: none; color: var(--faint); font-size: 22px; cursor: pointer;
          padding: 2px 6px; line-height: 1; border-radius: 2px;
        }
        .modal-close:hover { color: var(--bone); }
        .confirm { background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 22px; max-width: 340px; width: 100%; }
        .confirm h2 {
          margin: 0 0 8px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600;
          font-size: 19px; letter-spacing: .05em; text-transform: uppercase;
        }
        .confirm p { margin: 0 0 20px; color: var(--muted); font-size: 14px; line-height: 1.5; }
        .confirm .actions { margin-top: 0; justify-content: flex-end; }
        .danger-btn {
          background: var(--danger); border: 1px solid var(--danger); color: var(--stage);
          font-family: 'Barlow Condensed', sans-serif; font-weight: 600; letter-spacing: .11em;
          text-transform: uppercase; font-size: 14px; padding: 10px 18px; border-radius: 2px; cursor: pointer;
        }
        .danger-btn:hover { filter: brightness(1.1); }

        .wrap button:focus-visible, .wrap .input:focus-visible, .wrap select:focus-visible, .wrap input[type="range"]:focus-visible {
          outline: 2px solid var(--brass); outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) { .fret svg circle { transition: none; } }

        @media (max-width: 560px) {
          .masthead h1 { font-size: 25px; }
          .triple { flex-wrap: wrap; }
          .triple .field { min-width: 84px; }
        }

        @media (max-width: 480px) {
          .select-chip { max-width: 132px; }
          .add-label-full { display: none; }
          .add-label-short { display: inline; }
        }
      `}</style>

      <div className="inner">
        <div className="masthead">
          <h1>Repertoire</h1>
          <span className="count">
            {songs.length} {songs.length === 1 ? "song" : "songs"}
          </span>
        </div>

        <div className="bar">
          <select
            className="select-chip"
            aria-label="Filter by artist"
            value={artistFilter}
            onChange={(e) => setArtistFilter(e.target.value)}
          >
            <option value="">All artists</option>
            {distinctArtists.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="select-chip"
            aria-label="Filter by progress"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All progress</option>
            {PROGRESS_FILTER_OPTIONS.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button className="primary" onClick={openAdd}>
            <span className="add-label-full">+ Add song</span>
            <span className="add-label-short">+</span>
          </button>
        </div>

        {loading ? (
          <div className="empty">
            <p className="hint">Loading…</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <p>{songs.length === 0 ? "No songs yet." : "Nothing matches this filter."}</p>
            <p className="hint">
              {songs.length === 0 ? "Add the first one you're working on." : "Try a different filter."}
            </p>
          </div>
        ) : (
          <div>
            {shown.map((s) => (
              <div className="row" key={s.id} onClick={() => openEdit(s)}>
                <div className="meat">
                  <div className="title">
                    {s.title}
                    {s.artist && <span className="artist"> — {s.artist}</span>}
                  </div>
                  {s.chords.length > 0 && (
                    <div className="chords-line">
                      {s.chords.map((c, i) => (
                        <span className="chord" key={i}>
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="chordline">
                    <span className="meta">
                      {[
                        s.songKey && `key ${s.songKey}`,
                        s.capo && s.capo !== "0" ? `capo ${s.capo}` : "No capo",
                        s.tuning && s.tuning !== "Standard" && s.tuning,
                      ]
                        .filter(Boolean)
                        .join("  ·  ")}
                    </span>
                  </div>
                </div>

                <div className="side">
                  <span className="tag">{styleOf(s.style || "strumming").label}</span>
                  <FretMarker status={s.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div
          className="overlay"
          onClick={(e) => e.target === e.currentTarget && closePanel()}
        >
          <div className="panel">
            <div className="modal-head">
              <div className="panel-heading">{editingId ? "Edit song" : "Add song"}</div>
              <button type="button" className="modal-close" aria-label="Close" onClick={closePanel}>
                ×
              </button>
            </div>

            <div className="grid">
              <Field
                label="Title"
                value={draft.title}
                onChange={setField("title")}
                placeholder="Blackbird"
                onEnter={submit}
                inputRef={titleRef}
              />

              <label className="field">
                <span className="field-label">Artist</span>
                <div className="autocomplete">
                  <input
                    className="input"
                    autoComplete="off"
                    value={draft.artist}
                    placeholder="The Beatles"
                    onChange={(e) => {
                      setField("artist")(e.target.value);
                      setArtistSuggestOpen(true);
                    }}
                    onFocus={() => setArtistSuggestOpen(true)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                  />
                  <div className={`ac-list ${artistSuggestOpen && artistMatches.length ? "open" : ""}`}>
                    {artistMatches.map((a) => (
                      <div
                        key={a}
                        className="ac-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setField("artist")(a);
                          setArtistSuggestOpen(false);
                        }}
                      >
                        {a}
                      </div>
                    ))}
                  </div>
                </div>
              </label>

              <div className="triple">
                <Field label="Key" mono value={draft.songKey} onChange={setField("songKey")} placeholder="G" onEnter={submit} />
                <Field label="Capo" mono value={draft.capo} onChange={setField("capo")} placeholder="0" onEnter={submit} />
                <Field label="Tuning" mono value={draft.tuning} onChange={setField("tuning")} placeholder="Standard" onEnter={submit} />
              </div>

              <div className="field">
                <span className="field-label">Chords</span>
                <div className="chords-wrap">
                  {draft.chords.map((c, i) => (
                    <div className="chord-field" key={i}>
                      <input
                        value={c}
                        placeholder="Am"
                        onChange={(e) => setChord(i, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                      />
                      <button
                        type="button"
                        className="chord-remove"
                        aria-label="Remove chord"
                        onClick={() => removeChordField(i)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className="chord-add" aria-label="Add chord" onClick={addChordField}>
                    +
                  </button>
                </div>
              </div>

              <div className="field">
                <span className="field-label">Progress</span>
                <div className="progress-slider">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="1"
                    value={statusOf(draft.status).fret}
                    onChange={(e) => {
                      const match = STATUSES.find((st) => st.fret === Number(e.target.value));
                      setField("status")(match ? match.id : "queued");
                    }}
                  />
                  <div className="progress-ticks">
                    {STATUSES.map((st) => (
                      <span key={st.id} className={`progress-tick ${st.fret <= statusOf(draft.status).fret ? "on" : ""}`} />
                    ))}
                  </div>
                </div>
                <div className="progress-current">{statusOf(draft.status).label}</div>
              </div>

              <div className="field">
                <span className="field-label">Style</span>
                <div className="chip-row">
                  {STYLES.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      className={`chip ${draft.style === st.id ? "on" : ""}`}
                      onClick={() => setField("style")(st.id)}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="actions">
              {editingId ? (
                <>
                  <button className="primary solid" onClick={submit}>
                    Save
                  </button>
                  <button className="danger-btn" onClick={() => requestRemove({ id: editingId, title: draft.title })}>
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <button className="primary solid" onClick={submit}>
                    Add song
                  </button>
                  <button className="ghost" onClick={closePanel}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingRemove && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && cancelRemove()}>
          <div className="confirm">
            <h2>Remove song?</h2>
            <p>Remove "{pendingRemove.title}" from your repertoire? This can’t be undone.</p>
            <div className="actions">
              <button className="ghost" onClick={cancelRemove}>
                Cancel
              </button>
              <button className="danger-btn" onClick={confirmRemove}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

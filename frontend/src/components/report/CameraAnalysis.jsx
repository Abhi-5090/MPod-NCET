import React from "react";
import PropTypes from "prop-types";

const ICONS = "/assets/report-icons/";

// "screen": the dark report page; "print": the white PDF layout.
const THEMES = {
  screen: {
    value: "#5EE3EC",
    label: undefined,
    firstRow: "row g-3 d-flex justify-content-evenly",
    panels: [
      { className: "col-12 col-md-6", style: { backgroundColor: "#1c1c1c", borderRadius: "10px", border: "1px solid #ffffff29" } },
      { className: "col-12 col-md-6", style: { backgroundColor: "#1c1c1c", borderRadius: "10px", border: "1px solid #ffffff29" } },
    ],
  },
  print: {
    value: "#008738",
    label: { color: "black" },
    firstRow: "row g-3",
    panels: [
      { className: "col-12 col-md-6", style: { backgroundColor: "#fff", borderRadius: "10px", marginRight: "20px", marginLeft: "30px", border: "1px solid #008738" } },
      { className: "col-12 col-md-5", style: { backgroundColor: "#fff", borderRadius: "10px", border: "1px solid #008738" } },
    ],
  },
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// The interview stores one summary object (older records: an array with one).
const normalise = (e) => {
  const src = Array.isArray(e) ? e[0] : e;
  if (!src || typeof src !== "object") return null;
  const em = src.emotions || {};
  const anyEmotion = Object.values(em).some((v) => num(v) > 0);
  const anyTime = num(src.time_straight) + num(src.time_left) + num(src.time_right) + num(src.time_away) > 0;
  return anyEmotion || anyTime ? { ...src, emotions: em } : null;
};

function Stat({ icon, label, value, theme, col, first }) {
  return (
    <div className={col} style={first ? { marginBottom: "20px" } : undefined}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "10px" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {icon && <img src={`${ICONS}${icon}.png`} width="20px" style={{ marginRight: "5px" }} alt="" />}
          <p className="mb-1" style={theme.label}>{label}</p>
        </div>
        <h5 style={{ color: theme.value, marginTop: "5px" }}>{value}</h5>
      </div>
    </div>
  );
}

Stat.propTypes = {
  icon: PropTypes.string,
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  theme: PropTypes.object.isRequired,
  col: PropTypes.string.isRequired,
  first: PropTypes.bool,
};

/**
 * Camera results recorded during the interview: where the student looked (their own
 * left and right), how long the face was not visible, blinks and the share of each
 * facial expression. Shown for every interview type.
 */
export default function CameraAnalysis({ emotions, variant = "screen" }) {
  const theme = THEMES[variant] || THEMES.screen;
  const data = normalise(emotions);

  if (!data) {
    return (
      <div className="container text-center py-3">
        <p style={{ color: variant === "print" ? "#555" : "#aaaaaa", margin: 0 }}>
          Camera analysis was not recorded for this interview.
        </p>
      </div>
    );
  }

  const em = data.emotions;
  const pct = (k) => `${num(em[k])}%`;
  const sec = (k) => `${num(data[k])} SEC`;
  const [p1, p2] = theme.panels;
  const quarter = "col-6 col-sm-3";
  const third = "col-4 col-sm-4";

  return (
    <div className="container text-center text-light py-4">
      <div className={theme.firstRow}>
        <div className={p1.className} style={p1.style}>
          <div className="row g-3">
            <Stat first col={quarter} theme={theme} icon="seen-left" label="SEEN LEFT" value={num(data.seen_left)} />
            <Stat col={quarter} theme={theme} icon="seen-center" label="SEEN CENTER" value={num(data.seen_center)} />
            <Stat col={quarter} theme={theme} icon="blink" label="EYES BLINK" value={num(data.blinks)} />
            <Stat col={quarter} theme={theme} icon="seen-right" label="SEEN RIGHT" value={num(data.seen_right)} />
          </div>
        </div>
        <div className={p2.className} style={p2.style}>
          <div className="row g-3">
            <Stat col={quarter} theme={theme} icon="angry" label="ANGRY" value={pct("angry")} />
            <Stat col={quarter} theme={theme} icon="disgust" label="DISGUST" value={pct("disgust")} />
            <Stat col={quarter} theme={theme} icon="fear" label="FEAR" value={pct("fear")} />
            <Stat col={quarter} theme={theme} icon="happy" label="HAPPY" value={pct("happy")} />
          </div>
        </div>
      </div>

      <div className={`${theme.firstRow} mt-3`}>
        <div className={p1.className} style={p1.style}>
          <div className="row g-3">
            <Stat first col={quarter} theme={theme} icon="seen-left" label="LOOKING LEFT" value={sec("time_left")} />
            <Stat col={quarter} theme={theme} icon="seen-center" label="LOOKING STRAIGHT" value={sec("time_straight")} />
            <Stat col={quarter} theme={theme} icon="seen-right" label="LOOKING RIGHT" value={sec("time_right")} />
            <Stat col={quarter} theme={theme} label="NOT VISIBLE" value={sec("time_away")} />
          </div>
        </div>
        <div className={p2.className} style={p2.style}>
          <div className="row g-3">
            <Stat col={third} theme={theme} icon="neutral" label="NEUTRAL" value={pct("neutral")} />
            <Stat col={third} theme={theme} icon="sad" label="SAD" value={pct("sad")} />
            <Stat col={third} theme={theme} icon="surprise" label="SURPRISE" value={pct("surprise")} />
          </div>
        </div>
      </div>
    </div>
  );
}

CameraAnalysis.propTypes = {
  emotions: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  variant: PropTypes.oneOf(["screen", "print"]),
};

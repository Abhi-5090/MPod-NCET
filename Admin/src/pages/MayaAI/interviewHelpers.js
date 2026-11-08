import React from "react"
import { Badge } from "reactstrap"
import { STUDENT_APP_URL } from "../../config/api"

// YYYY-MM-DD for yesterday in IST (UTC+5:30), matching the backend's default date.
export const getYesterdayDateString = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
  const yyyy = ist.getUTCFullYear()
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(ist.getUTCDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

// Builds a student-app report link, e.g. studentReportUrl("report", { roll_no, interview_type, id }).
export const studentReportUrl = (page, params) => {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value == null ? "" : value)}`)
    .join("&")
  return `${STUDENT_APP_URL}${page}?${query}`
}

// Toast text for interview delete responses: { message, refunded: boolean }.
export const deleteResultMessage = data => {
  const message = (data && data.message) || "Interview deleted"
  if (data && data.refunded === true) return `${message} — Credit refunded`
  if (data && data.refunded === false) return `${message} — No refund (interview started or expired)`
  return message
}

// Attempted / (Attempted + Expired) as a percentage string.
export const attemptedPercentage = (attempted, expired) => {
  const total = attempted + expired
  return total ? ((attempted / total) * 100).toFixed(2) : 0
}

// Badge colour for the statuses returned by the interview list endpoints.
export const statusColor = (status) =>
  ({
    Attempted: "success",
    Upcoming: "info",
    "In progress": "primary",
    Evaluating: "secondary",
    "Waiting for AI": "warning",
    "Evaluation failed": "danger",
    Expired: "dark",
  })[status] || "light";

export const canRetryEvaluation = (status) => status === "Evaluation failed" || status === "Waiting for AI";

// YYYY-MM-DD for today in IST (UTC+5:30). Lists open on today so freshly scheduled
// interviews are visible straight away.
export const getTodayDateString = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

// Delete is only allowed before the attempt starts, or once it can no longer progress.
export const canDeleteInterview = (status) =>
  status === "Upcoming" || status === "Expired" || status === "Evaluation failed";

// Inactive technologies/modules/topics/companies (status 0) are hidden from scheduling pickers.
export const isActiveOption = (item) => !!item && item.status !== 0 && item.status !== "0";

// Validation message for the number of questions, or null when it is within min..max.
export const questionCountError = (value, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return `please enter ${min} to ${max} questions`;
  return null;
};

// Camera summary from the list API (row.camera): share of time looking at the screen
// and the most frequent facial expression. null = camera not recorded.
export const cameraText = (camera) => {
  if (!camera) return "Not recorded"
  const parts = []
  if (camera.attention != null) parts.push(`Attention ${camera.attention}%`)
  if (camera.mood) parts.push(`mostly ${camera.mood} (${camera.mood_pct}%)`)
  return parts.join(", ") || "Not recorded"
}

const attentionColor = (a) => (a == null ? "secondary" : a >= 70 ? "success" : a >= 40 ? "warning" : "danger")

export const cameraCell = (camera) => {
  if (!camera) return <span className="text-muted">Not recorded</span>
  const details = `Looked away ${camera.looked_away} times, ${camera.blinks} blinks`
  return (
    <span title={details}>
      {camera.attention != null && <Badge color={attentionColor(camera.attention)} className="me-1">{camera.attention}% attention</Badge>}
      {camera.mood && <span className="text-capitalize">{camera.mood} {camera.mood_pct}%</span>}
    </span>
  )
}

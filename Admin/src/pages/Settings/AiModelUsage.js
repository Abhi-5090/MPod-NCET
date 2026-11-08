import React, { useCallback, useEffect, useState } from "react"
import PropTypes from "prop-types"
import { connect } from "react-redux"
import { Row, Col, Card, CardBody, CardTitle, Badge, Button, Alert, Spinner } from "reactstrap"
import { toast } from "react-toastify"
import axios from "axios"

import { setBreadcrumbItems } from "../../store/actions"
import { apiUrl, getErrorMessage } from "../../config/api"
import LoadState from "../../components/Common/LoadState"
import ConfirmModal from "../../components/Common/ConfirmModal"

// Endpoints (platform admins):
//   GET  settings/ai-model              provider in use, both providers, their models and status
//   PUT  settings/ai-model { provider } every AI request goes to this provider from now on
//   POST settings/ai-model/test { provider }
const breadcrumbItems = [
  { title: "Mpod", link: "#" },
  { title: "Settings", link: "#" },
  { title: "AI Model Usage", link: "#" },
]

// Event the AI status banner listens to, so it refreshes right after a switch.
export const AI_SETTINGS_CHANGED = "mpod:ai-settings-changed"

const TASKS = [
  ["generation", "Interview questions"],
  ["scoring", "Answer scoring"],
  ["summary", "Report summary"],
  ["coding", "Coding evaluation"],
]

const DETAILS = {
  dgx: { icon: "mdi-server-network", text: "Self-hosted models on the NVIDIA DGX Spark. Interview data stays on your own hardware." },
  openai: { icon: "mdi-cloud-outline", text: "OpenAI's hosted models over the internet, billed to the OpenAI account in the server settings." },
}

const formatDate = value => {
  if (!value) return ""
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString()
}

function StatusBadge({ provider }) {
  if (!provider.configured) return <Badge color="secondary">Not set up</Badge>
  const s = provider.status || {}
  if (s.ok === true) return <Badge color="success">Available</Badge>
  if (s.partial) return <Badge color="warning" className="text-dark">Some models missing</Badge>
  if (s.ok === false) return <Badge color="danger">Unavailable</Badge>
  return <Badge color="light" className="text-dark border">Not checked yet</Badge>
}

StatusBadge.propTypes = { provider: PropTypes.object.isRequired }

function ProviderCard({ provider, inUse, selected, onSelect, onTest, testing }) {
  const details = DETAILS[provider.name] || {}
  const s = provider.status || {}
  const disabled = !provider.configured
  return (
    <Card
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect(provider.name)}
      onKeyDown={e => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onSelect(provider.name)
        }
      }}
      className={`h-100 mb-0 ${selected ? "border-primary shadow" : "border"}`}
      style={{ borderWidth: 2, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.65 : 1, transition: "box-shadow .15s, border-color .15s" }}
    >
      <CardBody>
        <div className="d-flex align-items-start justify-content-between mb-3">
          <div className="d-flex align-items-center">
            <div
              className={`rounded-circle d-flex align-items-center justify-content-center me-3 ${selected ? "bg-primary text-white" : "bg-light text-primary"}`}
              style={{ width: 48, height: 48, fontSize: 24 }}
            >
              <i className={`mdi ${details.icon}`} />
            </div>
            <div>
              <h5 className="mb-1">{provider.label}</h5>
              <div className="d-flex flex-wrap gap-1">
                {inUse && <Badge color="primary">In use now</Badge>}
                <StatusBadge provider={provider} />
              </div>
            </div>
          </div>
          <i className={`mdi font-size-24 ${selected ? "mdi-radiobox-marked text-primary" : "mdi-radiobox-blank text-muted"}`} aria-hidden="true" />
        </div>

        <p className="text-muted mb-3">{details.text}</p>

        {provider.configured ? (
          <React.Fragment>
            <table className="table table-sm mb-3">
              <tbody>
                {TASKS.map(([task, label]) => (
                  <tr key={task}>
                    <td className="text-muted ps-0">{label}</td>
                    <td className="text-end pe-0">
                      <code>{(provider.models && provider.models[task]) || "—"}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="small text-muted mb-2 text-break">
              {provider.name === "dgx" ? `${provider.engine} at ` : "Endpoint: "}
              {provider.endpoint}
            </div>
            {s.ok === false && s.message && (
              <Alert color={s.partial ? "warning" : "danger"} className="py-2 px-3 small mb-2">
                {s.message}
                {s.hint ? ` Fix: ${s.hint}` : ""}
              </Alert>
            )}
            <div className="d-flex align-items-center justify-content-between">
              <span className="small text-muted">{s.checked_at ? `Checked ${formatDate(s.checked_at)}` : ""}</span>
              <Button
                size="sm"
                color="primary"
                outline
                disabled={testing}
                onClick={e => {
                  e.stopPropagation()
                  onTest(provider.name)
                }}
              >
                {testing ? <Spinner size="sm" className="me-1" /> : <i className="mdi mdi-lan-check me-1" />}
                Test connection
              </Button>
            </div>
          </React.Fragment>
        ) : (
          <Alert color="secondary" className="py-2 px-3 small mb-0">
            Not set up on the server.{" "}
            {provider.name === "dgx"
              ? "Add DGX_BASE_URL (and DGX_API_KEY) to backend/.env and restart the backend."
              : "Add OPENAI_API_KEY to backend/.env and restart the backend."}
          </Alert>
        )}
      </CardBody>
    </Card>
  )
}

ProviderCard.propTypes = {
  provider: PropTypes.object.isRequired,
  inUse: PropTypes.bool,
  selected: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
  onTest: PropTypes.func.isRequired,
  testing: PropTypes.bool,
}

const AiModelUsage = props => {
  const { setBreadcrumbItems: setBreadcrumbs } = props
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(null)

  useEffect(() => {
    document.title = "AI Model Usage | Mpod"
    setBreadcrumbs("AI Model Usage", breadcrumbItems)
  }, [setBreadcrumbs])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get(apiUrl("settings/ai-model"))
      setData(res.data)
      setSelected(res.data.provider)
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load the AI settings."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const labelOf = name => ((data && data.providers.find(p => p.name === name)) || {}).label || name

  const save = async () => {
    setSaving(true)
    try {
      const res = await axios.put(apiUrl("settings/ai-model"), { provider: selected })
      setData(res.data)
      setSelected(res.data.provider)
      setConfirming(false)
      window.dispatchEvent(new Event(AI_SETTINGS_CHANGED))
      const now = res.data.providers.find(p => p.name === res.data.provider)
      if (now && now.status && now.status.ok === false && !now.status.partial) {
        toast.warning(`Switched to ${now.label}, but it is not answering right now: ${now.status.message}`)
      } else {
        toast.success(`All AI requests now go to ${labelOf(res.data.provider)}.`)
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not change the AI model."))
    } finally {
      setSaving(false)
    }
  }

  const test = async name => {
    setTesting(name)
    try {
      const res = await axios.post(apiUrl("settings/ai-model/test"), { provider: name })
      const status = res.data.status
      setData(prev => ({ ...prev, providers: prev.providers.map(p => (p.name === name ? { ...p, status } : p)) }))
      if (status.ok) toast.success(`${labelOf(name)} is answering.`)
      else toast.error(`${labelOf(name)}: ${status.message}`)
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not test the connection."))
    } finally {
      setTesting(null)
    }
  }

  const changed = data && selected && selected !== data.provider
  // Saving the provider already in use still matters when it only came from backend/.env.
  const canSave = data && selected && (changed || !data.chosen)

  return (
    <React.Fragment>
      <Row>
        <Col xs="12">
          <Card>
            <CardBody>
              <CardTitle className="h4">AI Model Usage</CardTitle>
              <p className="text-muted mb-4">
                Choose which AI answers every interview: question generation, answer scoring, report summaries and
                coding evaluation. A change applies from the next AI request, for every college, without restarting
                anything.
              </p>

              <LoadState loading={loading} error={error} onRetry={load}>
                {data && (
                  <React.Fragment>
                    {data.chosen ? (
                      <Alert color="light" className="border mb-4">
                        <i className="mdi mdi-check-circle text-success me-1" />
                        Every AI request goes to <strong>{labelOf(data.provider)}</strong> only. Chosen
                        {data.chosen.updated_by_name ? ` by ${data.chosen.updated_by_name}` : ""}
                        {data.chosen.updated_at ? ` on ${formatDate(data.chosen.updated_at)}` : ""}.
                      </Alert>
                    ) : (
                      <Alert color="info" className="mb-4">
                        No model has been chosen here yet, so the server settings apply:{" "}
                        <strong>{labelOf(data.provider)}</strong>
                        {data.backup ? `, with ${labelOf(data.backup)} as backup when it is down` : ""}. Choose one
                        below and save to decide here instead.
                      </Alert>
                    )}

                    <Row className="g-4" role="radiogroup" aria-label="AI model">
                      {data.providers.map(p => (
                        <Col md="6" key={p.name}>
                          <ProviderCard
                            provider={p}
                            inUse={p.name === data.provider}
                            selected={p.name === selected}
                            onSelect={setSelected}
                            onTest={test}
                            testing={testing === p.name}
                          />
                        </Col>
                      ))}
                    </Row>

                    <div className="d-flex flex-wrap align-items-center justify-content-between mt-4 gap-2">
                      <span className="text-muted small">
                        <i className="mdi mdi-information-outline me-1" />
                        The chosen model is the only one used: if it stops answering, interviews use the question
                        bank and scores are completed once it is back.
                      </span>
                      <Button color="primary" disabled={!canSave || saving} onClick={() => setConfirming(true)}>
                        <i className="mdi mdi-content-save-outline me-1" />
                        {changed ? `Switch to ${labelOf(selected)}` : `Use ${labelOf(selected)}`}
                      </Button>
                    </div>
                  </React.Fragment>
                )}
              </LoadState>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <ConfirmModal
        isOpen={confirming}
        toggle={() => setConfirming(false)}
        onConfirm={save}
        busy={saving}
        title="Change AI model"
        confirmLabel={selected ? `Use ${labelOf(selected)}` : "Save"}
        confirmColor="primary"
        message={
          selected
            ? `From now on every AI request (questions, scoring, summaries and coding) goes to ${labelOf(selected)} only. Continue?`
            : ""
        }
      />
    </React.Fragment>
  )
}

AiModelUsage.propTypes = {
  setBreadcrumbItems: PropTypes.func,
}

export default connect(null, { setBreadcrumbItems })(AiModelUsage)

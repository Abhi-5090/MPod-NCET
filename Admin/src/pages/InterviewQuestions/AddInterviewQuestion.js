import React, { useEffect, useState } from "react"
import { Row, Col, Card, CardBody, FormGroup, Button, Label, Spinner } from "reactstrap"
import { AvForm } from "availity-reactstrap-validation"
import Select from "react-select"
import { toast } from "react-toastify"
import { connect } from "react-redux"
import { setBreadcrumbItems } from "../../store/actions"
import axios from "axios"
import { useNavigate } from "react-router-dom"
import { apiUrl, getErrorMessage } from "../../config/api"
import { TemplateButton, downloadExcelTemplate } from "../../components/Common/TemplateDownload"

const breadcrumbItems = [
  { title: "Mpod", link: "#" },
  { title: "Interview Questions", link: "/interview-questions-list" },
  { title: "Add Interview Question", link: "#" },
]

const AddInterviewQuestion = props => {
  document.title = "Add Interview Question | Mpod"

  const [technologyData, setTechnologyData] = useState([])
  const [selectedCompanies, setSelectedCompanies] = useState([])
  const [selectedTechnology, setSelectedTechnology] = useState(null)
  const [companyData, setCompanyData] = useState([])
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    props.setBreadcrumbItems("Add Interview Question", breadcrumbItems)
    fetchTechnologyData()
    fetchCompaniesData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchCompaniesData = async () => {
    try {
      const response = await axios.get(apiUrl("companies-list"))
      setCompanyData(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load companies."))
    }
  }

  const fetchTechnologyData = async () => {
    try {
      const response = await axios.get(apiUrl("get-technologies"))
      setTechnologyData(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load technologies."))
    }
  }

  const technologyOptions = technologyData.map(tech => ({
    label: tech.technology_name,
    value: tech._id,
  }))

  const companyOptions = companyData.map(comp => ({
    label: comp.company_name,
    value: comp._id,
  }))

  const addQuestions = async () => {
    if (!selectedTechnology) {
      toast.error("Please select a technology")
      return
    }

    if (!file) {
      toast.error("Please upload a questions file")
      return
    }

    const companies = selectedCompanies || []
    const previous_asked_status = companies.length > 0 ? 1 : 0
    const companyIds = companies.map(company => company.value)

    const formData = new FormData()
    formData.append("file", file)
    formData.append("company", JSON.stringify(companyIds))
    formData.append("technology", selectedTechnology.value)
    formData.append("previous_asked_status", previous_asked_status)

    setSubmitting(true)
    try {
      await axios.post(apiUrl("add-interview-questions"), formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      toast.success("Interview questions added successfully")
      navigate("/interview-questions-list")
    } catch (error) {
      toast.error(getErrorMessage(error, "Something went wrong while adding the questions"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleFileChange = event => {
    setFile(event.target.files[0] || null)
  }

  const downloadTemplate = () =>
    downloadExcelTemplate({
      fileName: "interview_questions_template.xlsx",
      sheetName: "Questions",
      rows: [
        {
          question: "What is the difference between == and equals() in Java?",
          answer:
            "== compares object references (or primitive values); equals() compares logical content and can be overridden, e.g. String.equals compares characters.",
          star_status: 1,
        },
        {
          question: "What is the difference between ArrayList and LinkedList?",
          answer:
            "ArrayList is backed by a resizable array with fast random access; LinkedList is a doubly linked list with fast inserts/removals at the ends but slow index access.",
          star_status: 0,
        },
      ],
    })

  return (
    <React.Fragment>
      <Row>
        <Col xl="6">
          <Card>
            <CardBody>
              <h4 className="card-title">Add Interview Question</h4>
              <AvForm className="needs-validation">
                <Row>
                  <Col md="6">
                    <FormGroup>
                      <Label>Select Technology</Label>
                      <Select
                        value={selectedTechnology}
                        onChange={setSelectedTechnology}
                        options={technologyOptions}
                        classNamePrefix="select2-selection"
                      />
                    </FormGroup>
                  </Col>
                </Row>

                <Row>
                  <Col md="6">
                    <FormGroup>
                      <Label>Select Companies (Multi-select)</Label>
                      <Select
                        isMulti
                        value={selectedCompanies}
                        onChange={setSelectedCompanies}
                        options={companyOptions}
                        classNamePrefix="select2-selection"
                      />
                    </FormGroup>
                  </Col>
                </Row>

                <Row>
                  <Col md="6">
                    <FormGroup>
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <Label className="mb-0">Upload questions File</Label>
                        <TemplateButton onClick={downloadTemplate} />
                      </div>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="form-control"
                        onChange={handleFileChange}
                      />
                      <small className="form-text text-muted d-block">
                        Columns: question, answer, star_status (1 = asked by a company before, optional).
                      </small>
                    </FormGroup>
                  </Col>
                </Row>

                <Button color="primary" type="button" onClick={addQuestions} disabled={submitting}>
                  {submitting && <Spinner size="sm" className="me-1" />}
                  Submit
                </Button>
              </AvForm>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </React.Fragment>
  )
}

export default connect(null, { setBreadcrumbItems })(AddInterviewQuestion)

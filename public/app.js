const uploadForm = document.querySelector("#uploadForm");
const fileInput = document.querySelector("#files");
const submitButton = document.querySelector("#submitButton");
const cancelButton = document.querySelector("#cancelButton");
const statusElement = document.querySelector("#status");
const resultsElement = document.querySelector("#results");
const pandaPanel = document.querySelector(".panda-panel");
const pandaBadge = document.querySelector("#pandaBadge");

let activeJobId = null;
let pollTimer = null;
let isPolling = false;

const pandaStates = {
  idle: {
    badge: "În așteptare",
    badgeClass: "idle"
  },
  processing: {
    badge: "Procesează",
    badgeClass: "working"
  },
  success: {
    badge: "Finalizat",
    badgeClass: "success"
  },
  cancelled: {
    badge: "Anulat",
    badgeClass: "cancelled"
  },
  error: {
    badge: "Eroare",
    badgeClass: "error"
  }
};

function setStatus(message, state = "idle") {
  statusElement.textContent = message;
  statusElement.className = `status ${state}`;
}

function setPandaState(state) {
  const nextState = pandaStates[state] ? state : "idle";
  const content = pandaStates[nextState];

  if (pandaPanel) {
    pandaPanel.dataset.pandaState = nextState;
  }

  if (pandaBadge) {
    pandaBadge.textContent = content.badge;
    pandaBadge.className = `panda-badge ${content.badgeClass}`;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function isFinalJobStatus(status) {
  return (
    status === "completed" ||
    status === "completed_with_errors" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function formatElapsed(seconds) {
  if (!seconds) {
    return null;
  }

  if (seconds < 60) {
    return `${seconds}s scurse`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s scurse`;
}

function describeResult(result) {
  if (result.status === "queued") {
    return "Fișierul așteaptă pornirea procesării.";
  }

  if (result.status === "cancelling") {
    return "Se anulează cererea.";
  }

  if (result.status === "processing") {
    const parts = [];

    if (result.stage === "uploading_to_openai") {
      parts.push("Fișierul se încarcă pentru prelucrare.");
    } else if (result.stage === "uploaded_to_openai") {
      parts.push("Fișierul a fost încărcat și este pregătit pentru analiză.");
    } else if (result.stage === "response_created") {
      parts.push("Analiza a pornit.");
    } else if (result.stage === "waiting_for_openai") {
      parts.push("Se extrag etichetele și se pregătește fișierul final.");
    } else if (result.stage === "finalizing_output") {
      parts.push("Se finalizează rezultatul pentru descărcare.");
    } else {
      parts.push("Fișierul este în procesare.");
    }

    const elapsed = formatElapsed(result.elapsedSeconds);
    if (elapsed) {
      parts.push(elapsed);
    }

    return parts.join(" ");
  }

  if (result.status === "cancelled") {
    return "Analiza a fost anulată înainte de generarea fișierului.";
  }

  if (result.status === "failed") {
    return result.error || "Procesarea fișierului a eșuat.";
  }

  if (result.generatedFile) {
    return "Fișier Generat cu Succes";
  }

  return "Procesarea s-a finalizat, dar fișierul Excel nu este disponibil.";
}

function renderResults(results) {
  if (!results.length) {
    resultsElement.innerHTML = '<div class="empty-state">Nu există fișiere procesate încă.</div>';
    return;
  }

  resultsElement.innerHTML = results
    .map((result) => {
      const badgeClass =
        result.status === "failed"
          ? "error"
          : result.status === "completed"
            ? "success"
            : result.status === "cancelled"
              ? "cancelled"
              : "working";

      const badgeLabel =
        result.status === "queued"
          ? "În așteptare"
          : result.status === "processing"
            ? "În procesare"
            : result.status === "cancelling"
              ? "Se anulează"
              : result.status === "completed"
                ? "Finalizat"
                : result.status === "cancelled"
                  ? "Anulat"
                  : "Eroare";

      const actions =
        result.status === "completed" && result.generatedFile
          ? `<a class="download-link" href="${result.generatedFile.url}" download="${escapeHtml(
              result.generatedFile.filename
            )}">Descarcă ${escapeHtml(result.generatedFile.filename)}</a>`
          : result.status === "completed"
            ? '<span class="download-link disabled">Fișier Excel indisponibil</span>'
            : "";

      const copyClass =
        result.status === "completed"
          ? result.generatedFile
            ? "success-copy"
            : "pending-copy"
          : result.status === "failed"
            ? "error-copy"
            : "pending-copy";

      return `
        <article class="result-card ${result.status === "failed" ? "error" : ""}">
          <div class="result-header">
            <h3>${escapeHtml(result.inputFilename)}</h3>
            <span class="badge ${badgeClass}">${badgeLabel}</span>
          </div>
          ${actions ? `<div class="actions">${actions}</div>` : ""}
          <p class="${copyClass}">${escapeHtml(describeResult(result))}</p>
        </article>
      `;
    })
    .join("");
}

function updateCancelButton(job = null) {
  if (!cancelButton) {
    return;
  }

  const canShow =
    job &&
    activeJobId === job.id &&
    (job.status === "queued" || job.status === "processing" || job.status === "cancelling");

  cancelButton.hidden = !canShow;
  cancelButton.textContent = job?.status === "cancelling" ? "Se anulează..." : "Anulează analiza";
  cancelButton.disabled = !canShow || job?.status === "cancelling";
}

function updateStatusFromJob(job) {
  const primaryResult = Array.isArray(job.results) ? job.results[0] : null;

  if (job.status === "queued") {
    setStatus("Lucrarea este în așteptare. Fișierul este pregătit.", "working");
    setPandaState("processing");
    updateCancelButton(job);
    return;
  }

  if (job.status === "processing") {
    setStatus("Fișierul este în procesare.", "working");
    setPandaState("processing");
    updateCancelButton(job);
    return;
  }

  if (job.status === "cancelling") {
    setStatus("Se anulează cererea.", "working");
    setPandaState("processing");
    updateCancelButton(job);
    return;
  }

  if (job.status === "completed") {
    if (primaryResult?.generatedFile) {
      setStatus("Procesare finalizată. Fișierul este gata.", "success");
      setPandaState("success");
    } else {
      setStatus("Procesarea s-a finalizat, dar fișierul nu este disponibil.", "error");
      setPandaState("error");
    }
    updateCancelButton(null);
    return;
  }

  if (job.status === "completed_with_errors") {
    setStatus("Procesarea s-a finalizat cu erori.", "error");
    setPandaState("error");
    updateCancelButton(null);
    return;
  }

  if (job.status === "cancelled") {
    setStatus("Analiza a fost anulată.", "idle");
    setPandaState("cancelled");
    updateCancelButton(null);
    return;
  }

  setStatus("Lucrarea nu a putut fi finalizată.", "error");
  setPandaState("error");
  updateCancelButton(null);
}

async function pollJob(jobId) {
  if (isPolling || activeJobId !== jobId) {
    return;
  }

  isPolling = true;

  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();

    if (!response.ok) {
      throw new Error(job.error || "Nu s-a putut citi starea procesării.");
    }

    renderResults(job.results || []);
    updateStatusFromJob(job);

    if (isFinalJobStatus(job.status)) {
      submitButton.disabled = false;
      activeJobId = null;
      updateCancelButton(null);
      stopPolling();
      return;
    }

    pollTimer = setTimeout(() => {
      void pollJob(jobId);
    }, 3000);
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "A apărut o problemă la actualizarea stării.",
      "error"
    );
    setPandaState("error");
    submitButton.disabled = false;
    updateCancelButton(null);
    activeJobId = null;
    stopPolling();
  } finally {
    isPolling = false;
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    if (!data.openaiConfigured) {
      setStatus("Aplicația nu este configurată complet pentru procesare.", "error");
      setPandaState("error");
    }
  } catch {
    setStatus("Nu s-a putut verifica disponibilitatea aplicației.", "error");
    setPandaState("error");
  }
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!fileInput.files.length) {
    setStatus("Selectează un fișier `.xlsx`.", "error");
    setPandaState("idle");
    return;
  }

  if (fileInput.files.length > 1) {
    setStatus("Poți încărca un singur fișier `.xlsx`.", "error");
    setPandaState("idle");
    return;
  }

  stopPolling();
  activeJobId = null;
  updateCancelButton(null);

  const formData = new FormData();
  formData.append("files", fileInput.files[0]);

  submitButton.disabled = true;
  setStatus("Fișierul este trimis spre procesare...", "working");
  setPandaState("processing");

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      body: formData
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Cererea nu a putut fi procesată.");
    }

    activeJobId = payload.id;
    renderResults(payload.results || []);
    updateStatusFromJob(payload);
    void pollJob(payload.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Cererea a eșuat.", "error");
    setPandaState("error");
    submitButton.disabled = false;
    updateCancelButton(null);
  }
});

cancelButton?.addEventListener("click", async () => {
  if (!activeJobId) {
    return;
  }

  cancelButton.disabled = true;
  cancelButton.textContent = "Se anulează...";
  setStatus("Se anulează cererea...", "working");

  try {
    const response = await fetch(`/api/jobs/${activeJobId}/cancel`, {
      method: "POST"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nu s-a putut anula analiza.");
    }

    renderResults(payload.results || []);
    updateStatusFromJob(payload);

    if (isFinalJobStatus(payload.status)) {
      submitButton.disabled = false;
      activeJobId = null;
      updateCancelButton(null);
      stopPolling();
      return;
    }

    void pollJob(payload.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Nu s-a putut anula analiza.", "error");
    updateCancelButton(activeJobId ? { id: activeJobId, status: "processing" } : null);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) {
    setPandaState("idle");
    setStatus("Fișierul este pregătit pentru procesare.", "idle");
  } else {
    setPandaState("idle");
    setStatus("Selectează un fișier `.xlsx`.", "idle");
  }
});

updateCancelButton(null);
setPandaState("idle");
void loadHealth();

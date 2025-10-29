/*
 * NOEM Intranet front-end logic
 * Configure the constants below with your own API keys before deploying.
 */

const CONFIG = {
  SHEET_ID: "1uf2uOV_kNjq9k2FaWfyTvBPRy6FbieXuOiWLREbS140",
  API_KEY: "VOTRE_CLE_API_GOOGLE",
  OPEN_WEATHER_KEY: "VOTRE_CLE_OPENWEATHER",
  WEBHOOK_URL: "https://script.google.com/macros/s/XXXXXXXX/exec", // Google Apps Script Web App pour l'écriture
  HOURS_RANGE: "Comptes Rendu!A:E",
  ANNOUNCEMENTS_RANGE: "Annonces!A:D",
  IDEAS_RANGE: "Idées!A:C"
};

const state = {
  rows: [],
  announcements: [],
  collaborators: new Map(),
  clients: new Map(),
  charts: {},
  notifications: []
};

document.addEventListener("DOMContentLoaded", () => {
  displayConfig();
  initNavigation();
  initForms();
  initSearch();
  startClock();
  fetchWeather();
  fetchAllData();
});

function displayConfig() {
  document.getElementById("sheet-id-display").textContent = CONFIG.SHEET_ID;
  document.getElementById("api-key-display").textContent = CONFIG.API_KEY || "Définir API_KEY";
  document.getElementById("webhook-display").textContent = CONFIG.WEBHOOK_URL || "Définir WEBHOOK_URL";
}

function initNavigation() {
  const links = document.querySelectorAll(".nav-link");
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

function initForms() {
  document
    .getElementById("announcement-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = document.getElementById("announcement-title").value.trim();
      const author = document.getElementById("announcement-author").value.trim();
      const text = document.getElementById("announcement-text").value.trim();
      if (!title || !author || !text) return;

      const payload = { type: "announcement", title, author, text, createdAt: new Date().toISOString() };
      await submitToWebhook(payload);
      event.target.reset();
      notify("Annonce envoyée pour validation.");
      fetchAnnouncements();
    });

  document.getElementById("idea-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("idea-name").value.trim();
    const idea = document.getElementById("idea-text").value.trim();
    const priority = document.getElementById("idea-priority").value;
    if (!name || !idea) return;

    const payload = { type: "idea", name, idea, priority, createdAt: new Date().toISOString() };
    await submitToWebhook(payload);
    event.target.reset();
    notify("Merci ! Votre idée a été transmise.");
  });

  document.getElementById("refresh-announcements").addEventListener("click", fetchAnnouncements);
}

function initSearch() {
  const globalSearch = document.getElementById("global-search");
  const collaboratorSearch = document.getElementById("collaborator-search");
  const clientSearch = document.getElementById("client-search");

  globalSearch.addEventListener("input", () => filterGlobal(globalSearch.value));
  collaboratorSearch.addEventListener("input", () => renderCollaborators(collaboratorSearch.value));
  clientSearch.addEventListener("input", () => renderClients(clientSearch.value));
}

async function fetchAllData() {
  await Promise.all([fetchHours(), fetchAnnouncements()]);
  updateNotifications();
}

async function fetchHours() {
  try {
    const values = await fetchSheet(CONFIG.HOURS_RANGE);
    if (!values.length) return;

    const headers = values[0];
    const rows = values.slice(1).map((row) => mapRow(headers, row));
    state.rows = rows;

    computeAggregations();
    renderHoursTable(rows);
    updateDashboard();
    renderCollaborators();
    renderClients();
    buildCharts();
  } catch (error) {
    console.error("Erreur de lecture des heures", error);
    notify("Impossible de lire les heures (voir console).");
  }
}

async function fetchAnnouncements() {
  try {
    const values = await fetchSheet(CONFIG.ANNOUNCEMENTS_RANGE);
    const headers = values[0] || [];
    const rows = values.slice(1).map((row) => mapRow(headers, row));
    state.announcements = rows
      .filter((item) => item.Titre || item.Title)
      .map((item) => ({
        title: item.Titre || item.Title,
        author: item.Auteur || item.Author || "",
        text: item.Texte || item.Text || "",
        createdAt: item.Date || item.CreatedAt || new Date().toISOString()
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    renderAnnouncements();
  } catch (error) {
    console.error("Erreur de lecture des annonces", error);
    notify("Impossible de lire les annonces (voir console).");
  }
}

async function fetchSheet(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(range)}?key=${CONFIG.API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Sheets API error: ${response.status}`);
  }
  const data = await response.json();
  return data.values || [];
}

function mapRow(headers, row) {
  return headers.reduce((acc, header, index) => {
    acc[header.trim()] = row[index] ?? "";
    return acc;
  }, {});
}

function computeAggregations() {
  state.collaborators = new Map();
  state.clients = new Map();

  state.rows.forEach((row) => {
    const collaborator = row["Collaborateur"] || "Inconnu";
    const client = row["Client"] || "N/A";
    const hours = parseFloat(row["Heures"]) || 0;
    const tasks = row["Tâches réalisées"] || row["Taches"] || "";
    const week = row["Semaine réalisée"] || row["Semaine"] || "";

    if (!state.collaborators.has(collaborator)) {
      state.collaborators.set(collaborator, {
        hours: 0,
        clients: new Set(),
        tasks: [],
        weeks: new Set()
      });
    }
    const collData = state.collaborators.get(collaborator);
    collData.hours += hours;
    if (client) collData.clients.add(client);
    if (tasks) collData.tasks.push(tasks);
    if (week) collData.weeks.add(week);

    if (!state.clients.has(client)) {
      state.clients.set(client, {
        hours: 0,
        collaborators: new Set(),
        missions: 0,
        weeks: new Set()
      });
    }
    const clientData = state.clients.get(client);
    clientData.hours += hours;
    clientData.collaborators.add(collaborator);
    clientData.missions += 1;
    if (week) clientData.weeks.add(week);
  });
}

function renderHoursTable(rows) {
  const tbody = document.querySelector("#hours-table tbody");
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row["Collaborateur"] || ""}</td>
      <td>${row["Client"] || ""}</td>
      <td>${formatNumber(row["Heures"])}</td>
      <td>${row["Tâches réalisées"] || row["Taches"] || ""}</td>
      <td>${row["Semaine réalisée"] || row["Semaine"] || ""}</td>`;
    tbody.appendChild(tr);
  });
}

function updateDashboard() {
  const totalHours = state.rows.reduce((acc, row) => acc + (parseFloat(row["Heures"]) || 0), 0);
  const uniqueWeeks = new Set(state.rows.map((row) => row["Semaine réalisée"] || row["Semaine"] || ""));

  document.getElementById("stat-total-hours").textContent = `${totalHours.toFixed(1)} h`;
  document.getElementById("stat-collaborators").textContent = state.collaborators.size;
  document.getElementById("stat-clients").textContent = state.clients.size;
  document.getElementById("stat-average-week").textContent = uniqueWeeks.size
    ? `${(totalHours / uniqueWeeks.size).toFixed(1)} h`
    : "--";
}

function renderCollaborators(filter = "") {
  const list = document.getElementById("collaborators-list");
  const normalizedFilter = filter.toLowerCase();
  list.innerHTML = "";

  Array.from(state.collaborators.entries())
    .filter(([name]) => name.toLowerCase().includes(normalizedFilter))
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([name, data]) => {
      const card = document.createElement("div");
      card.className = "card";
      const recentTasks = data.tasks.slice(-3).reverse();
      card.innerHTML = `
        <h2>${name}</h2>
        <span class="badge"><i class="fa-solid fa-clock"></i>${data.hours.toFixed(1)} h</span>
        <div class="meta">Clients récents : ${Array.from(data.clients).slice(-3).join(", ") || "-"}</div>
        <div>
          <strong>Dernières tâches</strong>
          <ul>
            ${recentTasks.map((task) => `<li>${task}</li>`).join("") || "<li>Aucune tâche renseignée</li>"}
          </ul>
        </div>
      `;
      list.appendChild(card);
    });
}

function renderClients(filter = "") {
  const list = document.getElementById("clients-list");
  list.innerHTML = "";
  const normalizedFilter = filter.toLowerCase();

  Array.from(state.clients.entries())
    .filter(([name]) => name.toLowerCase().includes(normalizedFilter))
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([name, data]) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h2>${name}</h2>
        <span class="badge"><i class="fa-solid fa-briefcase"></i>${data.missions} missions</span>
        <div class="meta">Total heures : ${data.hours.toFixed(1)} h</div>
        <div class="meta">Collaborateurs impliqués : ${Array.from(data.collaborators).join(", ") || "-"}</div>
      `;
      list.appendChild(card);
    });
}

function renderAnnouncements() {
  const container = document.getElementById("announcements-list");
  container.innerHTML = "";

  if (!state.announcements.length) {
    container.innerHTML = '<p class="meta">Aucune annonce pour le moment.</p>';
    return;
  }

  state.announcements.forEach((item) => {
    const element = document.createElement("article");
    element.className = "timeline-item";
    const date = formatDate(item.createdAt);
    element.innerHTML = `
      <h3>${item.title}</h3>
      <div class="meta">${date} • ${item.author || "NOEM"}</div>
      <p>${item.text}</p>
    `;
    container.appendChild(element);
  });

  notify(`Nouvelle annonce : ${state.announcements[0].title}`, true);
}

function buildCharts() {
  const collaboratorLabels = [];
  const collaboratorHours = [];
  state.collaborators.forEach((data, name) => {
    collaboratorLabels.push(name);
    collaboratorHours.push(Number(data.hours.toFixed(2)));
  });

  const clientLabels = [];
  const clientHours = [];
  state.clients.forEach((data, name) => {
    clientLabels.push(name);
    clientHours.push(Number(data.hours.toFixed(2)));
  });

  renderChart(
    "chart-hours-collaborators",
    "bar",
    {
      labels: collaboratorLabels,
      datasets: [
        {
          label: "Heures par collaborateur",
          data: collaboratorHours,
          backgroundColor: "rgba(201, 162, 39, 0.7)",
          borderRadius: 8
        }
      ]
    },
    { indexAxis: collaboratorLabels.length > 6 ? "y" : "x" }
  );

  renderChart(
    "chart-hours-clients",
    "doughnut",
    {
      labels: clientLabels,
      datasets: [
        {
          label: "Heures par client",
          data: clientHours,
          backgroundColor: clientLabels.map((_, idx) => colorFromIndex(idx))
        }
      ]
    },
    {
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#fff" }
        }
      }
    }
  );
}

function renderChart(id, type, data, options = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (state.charts[id]) {
    state.charts[id].destroy();
  }

  state.charts[id] = new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: "#fff" },
          grid: { color: "rgba(255,255,255,0.08)" }
        },
        y: {
          ticks: { color: "#fff" },
          grid: { color: "rgba(255,255,255,0.08)" }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#fff" }
        }
      },
      ...options
    }
  });
}

function filterGlobal(value) {
  const query = value.toLowerCase();
  const rows = document.querySelectorAll("#hours-table tbody tr");
  rows.forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? "" : "none";
  });
}

async function submitToWebhook(payload) {
  if (!CONFIG.WEBHOOK_URL || CONFIG.WEBHOOK_URL.includes("XXXXXXXX")) {
    console.warn("Webhook non configuré. Payload", payload);
    notify("Webhook non configuré : voir console pour les données.");
    return;
  }

  try {
    const response = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.status}`);
    }
  } catch (error) {
    console.error("Erreur webhook", error);
    notify("Échec de l'envoi : vérifier la console.");
  }
}

function startClock() {
  const clock = document.getElementById("clock");
  const update = () => {
    const now = new Date();
    clock.textContent = now.toLocaleString("fr-FR", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  update();
  setInterval(update, 60 * 1000);
}

async function fetchWeather() {
  if (!CONFIG.OPEN_WEATHER_KEY || CONFIG.OPEN_WEATHER_KEY.includes("VOTRE")) {
    document.getElementById("weather").innerHTML =
      '<span>Configurer OPEN_WEATHER_KEY dans <code>script.js</code></span>';
    return;
  }
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=Cherbourg,FR&units=metric&lang=fr&appid=${CONFIG.OPEN_WEATHER_KEY}`
    );
    if (!response.ok) throw new Error("OpenWeatherMap error");
    const data = await response.json();
    const weather = document.getElementById("weather");
    weather.innerHTML = `
      <strong>${Math.round(data.main.temp)}°C</strong>
      <span>${data.weather[0].description}</span>
    `;
  } catch (error) {
    console.error("Erreur météo", error);
    document.getElementById("weather").textContent = "Météo indisponible";
  }
}

function updateNotifications() {
  const container = document.getElementById("notifications");
  container.innerHTML = "";
  state.notifications.slice(0, 3).forEach((message) => {
    const pill = document.createElement("span");
    pill.className = "notification-pill";
    pill.textContent = message;
    container.appendChild(pill);
  });
}

function notify(message, pushToTop = false) {
  if (!message) return;
  if (pushToTop) {
    state.notifications.unshift(message);
  } else {
    state.notifications.push(message);
  }
  state.notifications = state.notifications.slice(-6);
  updateNotifications();
}

function colorFromIndex(index) {
  const colors = [
    "rgba(201, 162, 39, 0.8)",
    "rgba(255, 206, 86, 0.8)",
    "rgba(201, 180, 88, 0.8)",
    "rgba(230, 169, 39, 0.8)",
    "rgba(180, 140, 60, 0.8)",
    "rgba(255, 193, 79, 0.8)",
    "rgba(201, 162, 39, 0.5)"
  ];
  return colors[index % colors.length];
}

function formatNumber(value) {
  const number = parseFloat(value);
  if (Number.isNaN(number)) return value || "0";
  return number.toFixed(1);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  });
}

// Documents statiques — à personnaliser si besoin
const DOCUMENTS = [
  {
    label: "Dossier chantiers",
    icon: "fa-helmet-safety",
    url: "https://drive.google.com/drive/folders/XXXXXXXX"
  },
  { label: "Comptabilité", icon: "fa-coins", url: "https://drive.google.com/drive/folders/YYYYYYYY" },
  { label: "Ressources humaines", icon: "fa-people-roof", url: "https://drive.google.com/drive/folders/ZZZZZZZZ" },
  { label: "Identité de marque", icon: "fa-palette", url: "https://drive.google.com" }
];

renderDocuments();

function renderDocuments() {
  const container = document.getElementById("documents-list");
  if (!container) return;
  container.innerHTML = "";

  DOCUMENTS.forEach((doc) => {
    const card = document.createElement("div");
    card.className = "document-card";
    card.innerHTML = `
      <i class="fa-solid ${doc.icon} fa-2x" style="color: var(--accent);"></i>
      <div>${doc.label}</div>
      <a href="${doc.url}" target="_blank" rel="noopener noreferrer">Ouvrir <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
    `;
    container.appendChild(card);
  });
}

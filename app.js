const state = {
  records: [],
  toolEntries: new Map(),
  selectedTool: null,
  selectedManagerId: null,
  parsedCache: new Map(),
  badLineCount: 0,
  totalFiles: 0,
  processedFiles: 0,
  charts: {
    daily: null,
    toolSuccess: null,
    projectDuration: null,
  },
};

const dom = {
  pickFolderBtn: document.getElementById("pick-folder-btn"),
  folderInput: document.getElementById("folder-input"),
  toolSearch: document.getElementById("tool-search"),
  toolList: document.getElementById("tool-list"),
  managerList: document.getElementById("manager-list"),
  dateFrom: document.getElementById("date-from"),
  dateTo: document.getElementById("date-to"),
  applyFilter: document.getElementById("apply-filter"),
  statusText: document.getElementById("status-text"),
  fileProgress: document.getElementById("file-progress"),
  validCount: document.getElementById("valid-count"),
  badCount: document.getElementById("bad-count"),
  kpiTotal: document.getElementById("kpi-total"),
  kpiSuccessRate: document.getElementById("kpi-success-rate"),
  kpiAvgDuration: document.getElementById("kpi-avg-duration"),
  kpiActiveUsers: document.getElementById("kpi-active-users"),
  kpiP90Duration: document.getElementById("kpi-p90-duration"),
  kpiDailyAvg: document.getElementById("kpi-daily-avg"),
  usageSummary: document.getElementById("usage-summary"),
  usageList: document.getElementById("usage-list"),
};

const centerTextPlugin = {
  id: "centerTextPlugin",
  afterDraw(chart) {
    const text = chart?.config?.options?.plugins?.centerText?.text;
    if (!text) {
      return;
    }

    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const point = meta?.data?.[0];
    if (!point) {
      return;
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#104a3c";
    ctx.font = "700 28px Space Grotesk";
    ctx.fillText(text, point.x, point.y - 6);
    ctx.fillStyle = "#5a6650";
    ctx.font = "400 12px Chivo";
    ctx.fillText("成功率", point.x, point.y + 18);
    ctx.restore();
  },
};

Chart.register(centerTextPlugin);

dom.pickFolderBtn.addEventListener("click", pickFolder);
dom.folderInput.addEventListener("change", handleFolderUpload);
dom.toolSearch.addEventListener("input", renderToolList);
dom.applyFilter.addEventListener("click", refreshDashboard);

async function pickFolder() {
  if (!window.showDirectoryPicker) {
    setStatus("当前浏览器不支持目录选择API，请使用兼容模式上传。");
    return;
  }

  try {
    resetData();
    setStatus("正在读取文件夹...");

    const dirHandle = await window.showDirectoryPicker();
    const handles = [];

    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".txt")) {
        handles.push(entry);
      }
    }

    await registerFileHandles(handles);
  } catch (error) {
    if (error && error.name === "AbortError") {
      setStatus("已取消选择文件夹。");
      return;
    }
    setStatus(`读取失败: ${error.message || "未知错误"}`);
  }
}

async function handleFolderUpload(event) {
  const files = Array.from(event.target.files || []).filter((file) =>
    file.name.toLowerCase().endsWith(".txt")
  );

  if (files.length === 0) {
    setStatus("兼容模式未检测到 txt 文件。");
    return;
  }

  resetData();
  setStatus("兼容模式读取文件名中...");

  await registerPlainFiles(files);
}

async function registerFileHandles(handles) {
  resetRuntimeForFolder();
  state.totalFiles = handles.length;
  state.processedFiles = handles.length;

  for (const handle of handles) {
    const toolName = normalizeToolName(handle.name);
    state.toolEntries.set(toolName, { source: "handle", ref: handle });
  }

  finalizeRegistration();
}

async function registerPlainFiles(files) {
  resetRuntimeForFolder();
  state.totalFiles = files.length;
  state.processedFiles = files.length;

  for (const file of files) {
    const toolName = normalizeToolName(file.name);
    state.toolEntries.set(toolName, { source: "file", ref: file });
  }

  finalizeRegistration();
}

function normalizeToolName(filename) {
  return filename.replace(/\.txt$/i, "");
}

function finalizeRegistration() {
  state.selectedTool = null;
  state.selectedManagerId = null;
  updateProgress();
  renderToolList();
  renderManagerList([]);
  renderUsageDetails([]);
  resetDashboard();
  setStatus(`已读取 ${state.totalFiles} 个 txt 文件名，请点击一个 NX 工具开始分析。`);
}

function resetRuntimeForFolder() {
  state.records = [];
  state.parsedCache.clear();
  state.badLineCount = 0;
  state.totalFiles = 0;
  state.processedFiles = 0;
}

async function analyzeSelectedTools() {
  const toolName = state.selectedTool;
  if (!toolName) {
    setStatus("请先选择一个 NX 工具。");
    resetDashboard();
    renderManagerList([]);
    renderUsageDetails([]);
    return;
  }

  state.records = [];
  state.badLineCount = 0;
  state.totalFiles = 1;
  state.processedFiles = 0;
  updateProgress();
  setStatus(`正在解析 ${toolName} 的 txt 数据...`);

  const cached = state.parsedCache.get(toolName);
  if (cached) {
    state.records = [...cached.records];
    state.badLineCount = cached.badLineCount;
    state.processedFiles += 1;
    updateProgress();
  } else {
    const entry = state.toolEntries.get(toolName);
    if (entry) {
      let content = "";
      if (entry.source === "handle") {
        const file = await entry.ref.getFile();
        content = await file.text();
      } else {
        content = await entry.ref.text();
      }

      const result = parseTextContent(toolName, content);
      state.parsedCache.set(toolName, result);
      state.records = [...result.records];
      state.badLineCount = result.badLineCount;
    }

    state.processedFiles = 1;
    updateProgress();
  }

  const managerIds = getManagerIds(state.records);
  state.selectedManagerId = managerIds[0] || null;
  renderManagerList(managerIds);
  refreshDashboard();
  setStatus(`分析完成，当前工具为 ${toolName}。`);
}

function parseTextContent(toolName, content) {
  const records = [];
  let badLineCount = 0;

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split(",").map((segment) => segment.trim());
    if (parts.length < 5) {
      badLineCount += 1;
      continue;
    }

    const [user, startRaw, projectId, endRaw, stateRaw] = parts;
    const startTime = parseTimestamp(startRaw);
    const endTime = parseTimestamp(endRaw);
    const normalizedState = (stateRaw || "").toLowerCase();

    if (!user || !projectId || !startTime || !endTime) {
      badLineCount += 1;
      continue;
    }

    const durationMs = endTime.getTime() - startTime.getTime();
    if (durationMs < 0) {
      badLineCount += 1;
      continue;
    }

    const isSuccess = normalizedState === "success";
    const isFail = normalizedState === "fail";

    if (!isSuccess && !isFail) {
      badLineCount += 1;
      continue;
    }

    const record = {
      user,
      tool: toolName,
      projectId,
      startTime,
      endTime,
      dateKey: formatDateKey(startTime),
      state: isSuccess ? "Success" : "Fail",
      isSuccess,
      durationMs,
    };

    records.push(record);
  }

  return { records, badLineCount };
}

function parseTimestamp(text) {
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const timestamp = new Date(normalized);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resetData() {
  state.records = [];
  state.toolEntries = new Map();
  state.selectedTool = null;
  state.selectedManagerId = null;
  state.parsedCache = new Map();
  state.badLineCount = 0;
  state.totalFiles = 0;
  state.processedFiles = 0;
  dom.folderInput.value = "";
  resetDashboard();
  renderToolList();
}

function renderToolList() {
  const keyword = dom.toolSearch.value.trim().toLowerCase();
  const tools = Array.from(state.toolEntries.keys())
    .sort()
    .filter((tool) => tool.toLowerCase().includes(keyword));

  if (tools.length === 0) {
    dom.toolList.classList.add("empty");
    dom.toolList.textContent = state.toolEntries.size === 0 ? "请先选择文件夹" : "无匹配工具";
    return;
  }

  dom.toolList.classList.remove("empty");
  dom.toolList.innerHTML = "";

  for (const tool of tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tool-item${state.selectedTool === tool ? " active" : ""}`;
    button.addEventListener("click", async () => {
      if (state.selectedTool === tool) {
        return;
      }
      state.selectedTool = tool;
      state.selectedManagerId = null;
      renderToolList();
      await analyzeSelectedTools();
    });

    const name = document.createElement("span");
    name.className = "tool-item-name";
    name.textContent = tool;

    const meta = document.createElement("span");
    meta.className = "tool-item-meta";
    meta.textContent = ".txt";

    button.appendChild(name);
    button.appendChild(meta);
    dom.toolList.appendChild(button);
  }
}

function renderManagerList(managerIds) {
  if (managerIds.length === 0) {
    dom.managerList.classList.add("empty");
    dom.managerList.textContent = state.selectedTool ? "当前工具没有管理号记录" : "请选择一个 NX 工具";
    return;
  }

  dom.managerList.classList.remove("empty");
  dom.managerList.innerHTML = "";

  for (const managerId of managerIds) {
    const count = state.records.filter((record) => record.projectId === managerId).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `manager-item${state.selectedManagerId === managerId ? " active" : ""}`;
    button.addEventListener("click", () => {
      state.selectedManagerId = managerId;
      renderManagerList(managerIds);
      refreshDashboard();
    });

    const name = document.createElement("span");
    name.className = "manager-item-name";
    name.textContent = managerId;

    const meta = document.createElement("span");
    meta.className = "manager-item-meta";
    meta.textContent = `${count} 条`;

    button.appendChild(name);
    button.appendChild(meta);
    dom.managerList.appendChild(button);
  }
}

function resetDashboard() {
  state.records = [];
  state.badLineCount = 0;
  dom.validCount.textContent = "0";
  dom.badCount.textContent = "0";
  dom.kpiTotal.textContent = "0";
  dom.kpiSuccessRate.textContent = "0%";
  dom.kpiAvgDuration.textContent = "0 分钟";
  dom.kpiActiveUsers.textContent = "0";
  dom.kpiP90Duration.textContent = "0 分钟";
  dom.kpiDailyAvg.textContent = "0";
  renderDailyChart([], []);
  renderToolSuccessChart(0);
  renderProjectDurationChart([]);
}

function refreshDashboard() {
  const filtered = getFilteredRecords();
  const metrics = computeMetrics(filtered);

  dom.validCount.textContent = `${state.records.length}`;
  dom.badCount.textContent = `${state.badLineCount}`;
  dom.kpiTotal.textContent = `${metrics.total}`;
  dom.kpiSuccessRate.textContent = `${metrics.successRate.toFixed(1)}%`;
  dom.kpiAvgDuration.textContent = `${msToMinutes(metrics.avgSuccessDurationMs)} 分钟`;
  dom.kpiActiveUsers.textContent = `${metrics.activeUsers}`;
  dom.kpiP90Duration.textContent = `${msToMinutes(metrics.p90DurationMs)} 分钟`;
  dom.kpiDailyAvg.textContent = `${metrics.avgDailyUsage.toFixed(1)}`;

  renderDailyChart(metrics.dailyFrequency, metrics.dailySuccessFrequency);
  renderToolSuccessChart(metrics.successRate);
  renderProjectDurationChart(metrics.projectDurationTop);
  renderUsageDetails(filtered);
}

function getFilteredRecords() {
  const from = dom.dateFrom.value ? new Date(`${dom.dateFrom.value}T00:00:00`) : null;
  const to = dom.dateTo.value ? new Date(`${dom.dateTo.value}T23:59:59`) : null;

  return state.records.filter((record) => {
    if (from && record.startTime < from) {
      return false;
    }

    if (to && record.startTime > to) {
      return false;
    }

    return true;
  });
}

function computeMetrics(records) {
  if (records.length === 0) {
    return {
      total: 0,
      successRate: 0,
      avgSuccessDurationMs: 0,
      activeUsers: 0,
      p90DurationMs: 0,
      avgDailyUsage: 0,
      dailyFrequency: [],
      dailySuccessFrequency: [],
      projectDurationTop: [],
    };
  }

  let successCount = 0;
  let successDurationSum = 0;

  const activeUsers = new Set();
  const dailyCountMap = new Map();
  const dailySuccessMap = new Map();
  const projectDurationMap = new Map();
  const successDurations = [];

  for (const record of records) {
    activeUsers.add(record.user);

    dailyCountMap.set(record.dateKey, (dailyCountMap.get(record.dateKey) || 0) + 1);
    if (record.isSuccess) {
      dailySuccessMap.set(record.dateKey, (dailySuccessMap.get(record.dateKey) || 0) + 1);
    }

    projectDurationMap.set(
      record.projectId,
      (projectDurationMap.get(record.projectId) || 0) + record.durationMs
    );

    if (record.isSuccess) {
      successCount += 1;
      successDurationSum += record.durationMs;
      successDurations.push(record.durationMs);
    }
  }

  const total = records.length;
  const successRate = total === 0 ? 0 : (successCount / total) * 100;
  const avgSuccessDurationMs = successCount === 0 ? 0 : successDurationSum / successCount;

  successDurations.sort((a, b) => a - b);
  const p90DurationMs = percentile(successDurations, 0.9);

  const dailyFrequency = Array.from(dailyCountMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const dailySuccessFrequency = dailyFrequency.map(({ date }) => ({
    date,
    count: dailySuccessMap.get(date) || 0,
  }));

  const avgDailyUsage = dailyFrequency.length === 0 ? 0 : total / dailyFrequency.length;

  const projectDurationTop = Array.from(projectDurationMap.entries())
    .map(([projectId, duration]) => ({ projectId, duration }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);

  return {
    total,
    successRate,
    avgSuccessDurationMs,
    activeUsers: activeUsers.size,
    p90DurationMs,
    avgDailyUsage,
    dailyFrequency,
    dailySuccessFrequency,
    projectDurationTop,
  };
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1));
  return values[index];
}

function msToMinutes(ms) {
  return (ms / 60000).toFixed(1);
}

function renderDailyChart(data, successData) {
  const labels = data.map((item) => item.date);
  const values = data.map((item) => item.count);
  const successValues = successData.map((item) => item.count);

  const config = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "使用次数",
          data: values,
          borderColor: "#256d5a",
          backgroundColor: "rgba(37, 109, 90, 0.2)",
          tension: 0.2,
          fill: true,
        },
        {
          label: "成功次数",
          data: successValues,
          borderColor: "#c97940",
          backgroundColor: "rgba(201, 121, 64, 0.12)",
          tension: 0.2,
          fill: false,
        },
      ],
    },
    options: chartOptions(),
  };

  state.charts.daily = upsertChart("daily-frequency-chart", state.charts.daily, config);
}

function renderToolSuccessChart(rate) {
  const safeRate = Math.max(0, Math.min(100, Number(rate) || 0));
  const remainder = Math.max(0, 100 - safeRate);

  const config = {
    type: "doughnut",
    data: {
      labels: ["成功", "其余"],
      datasets: [
        {
          data: [safeRate, remainder],
          backgroundColor: ["#256d5a", "#e6ebe0"],
          borderWidth: 0,
          cutout: "76%",
          circumference: 360,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 120,
      animation: {
        duration: 450,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
        },
        centerText: {
          text: `${safeRate.toFixed(1)}%`,
        },
      },
    },
  };

  state.charts.toolSuccess = upsertChart("tool-success-chart", state.charts.toolSuccess, config);
}

function renderProjectDurationChart(data) {
  const labels = data.map((item) => item.projectId);
  const values = data.map((item) => (item.duration / 3600000).toFixed(2));

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "总时长(小时)",
          data: values,
          backgroundColor: "rgba(201, 121, 64, 0.75)",
          borderRadius: 8,
        },
      ],
    },
    options: chartOptions(),
  };

  state.charts.projectDuration = upsertChart(
    "project-duration-chart",
    state.charts.projectDuration,
    config
  );
}

function chartOptions(maxY) {
  const yConfig = maxY
    ? {
        beginAtZero: true,
        max: maxY,
      }
    : {
        beginAtZero: true,
      };

  return {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 120,
    animation: {
      duration: 450,
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: "#32412a",
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "#475744",
        },
        grid: {
          display: false,
        },
      },
      y: {
        ...yConfig,
        ticks: {
          color: "#475744",
        },
      },
    },
  };
}

function upsertChart(canvasId, existingChart, config) {
  if (existingChart) {
    existingChart.destroy();
  }

  const canvas = document.getElementById(canvasId);
  return new Chart(canvas, config);
}

function setStatus(message) {
  dom.statusText.textContent = message;
}

function updateProgress() {
  dom.fileProgress.textContent = `${state.processedFiles} / ${state.totalFiles}`;
}

function getManagerIds(records) {
  return Array.from(new Set(records.map((record) => record.projectId))).sort();
}

function renderUsageDetails(filteredRecords) {
  if (!state.selectedManagerId) {
    dom.usageSummary.textContent = "未选择管理号";
    dom.usageList.className = "usage-list empty-state";
    dom.usageList.textContent = "请选择管理号查看明细";
    return;
  }

  const managerRecords = filteredRecords
    .filter((record) => record.projectId === state.selectedManagerId)
    .sort((a, b) => b.startTime - a.startTime);

  dom.usageSummary.textContent = `${state.selectedManagerId} · ${managerRecords.length} 条记录`;

  if (managerRecords.length === 0) {
    dom.usageList.className = "usage-list empty-state";
    dom.usageList.textContent = "当前筛选条件下没有使用记录";
    return;
  }

  dom.usageList.className = "usage-list";
  dom.usageList.innerHTML = `
    <table class="usage-table">
      <thead>
        <tr>
          <th>使用人</th>
          <th>起始时间</th>
          <th>结束时间</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        ${managerRecords
          .map(
            (record) => `
              <tr>
                <td>${escapeHtml(record.user)}</td>
                <td>${formatDateTime(record.startTime)}</td>
                <td>${formatDateTime(record.endTime)}</td>
                <td><span class="usage-state ${record.isSuccess ? "success" : "fail"}">${record.state}</span></td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function formatDateTime(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

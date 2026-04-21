const state = {
  records: [],
  toolEntries: new Map(),
  selectedTools: new Set(),
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
  selectAllTools: document.getElementById("select-all-tools"),
  clearTools: document.getElementById("clear-tools"),
  analyzeTools: document.getElementById("analyze-tools"),
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
};

dom.pickFolderBtn.addEventListener("click", pickFolder);
dom.folderInput.addEventListener("change", handleFolderUpload);
dom.toolSearch.addEventListener("input", renderToolList);
dom.selectAllTools.addEventListener("click", () => {
  state.selectedTools = new Set(state.toolEntries.keys());
  renderToolList();
});
dom.clearTools.addEventListener("click", () => {
  state.selectedTools.clear();
  renderToolList();
});
dom.applyFilter.addEventListener("click", refreshDashboard);
dom.analyzeTools.addEventListener("click", analyzeSelectedTools);

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
  state.selectedTools = new Set(state.toolEntries.keys());
  updateProgress();
  renderToolList();
  resetDashboard();
  setStatus(`已读取 ${state.totalFiles} 个 txt 文件名，请选择工具后点击“分析所选工具”。`);
}

function resetRuntimeForFolder() {
  state.records = [];
  state.parsedCache.clear();
  state.badLineCount = 0;
  state.totalFiles = 0;
  state.processedFiles = 0;
}

async function analyzeSelectedTools() {
  const tools = Array.from(state.selectedTools);
  if (tools.length === 0) {
    setStatus("请先至少选择一个 NX 工具。");
    resetDashboard();
    return;
  }

  state.records = [];
  state.badLineCount = 0;
  state.totalFiles = tools.length;
  state.processedFiles = 0;
  updateProgress();
  setStatus("正在按所选工具解析 txt 数据...");

  for (const toolName of tools) {
    const cached = state.parsedCache.get(toolName);
    if (cached) {
      state.records.push(...cached.records);
      state.badLineCount += cached.badLineCount;
      state.processedFiles += 1;
      updateProgress();
      continue;
    }

    const entry = state.toolEntries.get(toolName);
    if (!entry) {
      state.processedFiles += 1;
      updateProgress();
      continue;
    }

    let content = "";
    if (entry.source === "handle") {
      const file = await entry.ref.getFile();
      content = await file.text();
    } else {
      content = await entry.ref.text();
    }

    const result = parseTextContent(toolName, content);
    state.parsedCache.set(toolName, result);
    state.records.push(...result.records);
    state.badLineCount += result.badLineCount;

    state.processedFiles += 1;
    updateProgress();
  }

  refreshDashboard();
  setStatus(`分析完成，已解析 ${tools.length} 个工具。`);
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
  state.selectedTools = new Set();
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
    const label = document.createElement("label");
    label.className = "tool-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedTools.has(tool);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedTools.add(tool);
      } else {
        state.selectedTools.delete(tool);
      }
    });

    const text = document.createElement("span");
    text.textContent = tool;

    label.appendChild(checkbox);
    label.appendChild(text);
    dom.toolList.appendChild(label);
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
  renderDailyChart([]);
  renderToolSuccessChart([]);
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

  renderDailyChart(metrics.dailyFrequency);
  renderToolSuccessChart(metrics.toolSuccessRate);
  renderProjectDurationChart(metrics.projectDurationTop);
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
      toolSuccessRate: [],
      projectDurationTop: [],
    };
  }

  let successCount = 0;
  let successDurationSum = 0;

  const activeUsers = new Set();
  const dailyCountMap = new Map();
  const toolAgg = new Map();
  const projectDurationMap = new Map();
  const successDurations = [];

  for (const record of records) {
    activeUsers.add(record.user);

    dailyCountMap.set(record.dateKey, (dailyCountMap.get(record.dateKey) || 0) + 1);

    const toolBucket = toolAgg.get(record.tool) || { total: 0, success: 0 };
    toolBucket.total += 1;
    if (record.isSuccess) {
      toolBucket.success += 1;
    }
    toolAgg.set(record.tool, toolBucket);

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

  const avgDailyUsage = dailyFrequency.length === 0 ? 0 : total / dailyFrequency.length;

  const toolSuccessRate = Array.from(toolAgg.entries())
    .map(([tool, bucket]) => ({
      tool,
      rate: bucket.total === 0 ? 0 : (bucket.success / bucket.total) * 100,
    }))
    .sort((a, b) => b.rate - a.rate);

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
    toolSuccessRate,
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

function renderDailyChart(data) {
  const labels = data.map((item) => item.date);
  const values = data.map((item) => item.count);

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
      ],
    },
    options: chartOptions(),
  };

  state.charts.daily = upsertChart("daily-frequency-chart", state.charts.daily, config);
}

function renderToolSuccessChart(data) {
  const labels = data.map((item) => item.tool);
  const values = data.map((item) => item.rate.toFixed(1));

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "成功率(%)",
          data: values,
          backgroundColor: "rgba(16, 74, 60, 0.75)",
          borderRadius: 8,
        },
      ],
    },
    options: chartOptions(100),
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

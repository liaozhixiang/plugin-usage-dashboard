const state = {
  records: [],
  rawProjects: new Set(),
  selectedProjects: new Set(),
  tools: new Set(),
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
  projectSearch: document.getElementById("project-search"),
  projectList: document.getElementById("project-list"),
  selectAllProjects: document.getElementById("select-all-projects"),
  clearProjects: document.getElementById("clear-projects"),
  toolFilter: document.getElementById("tool-filter"),
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
dom.projectSearch.addEventListener("input", renderProjectList);
dom.selectAllProjects.addEventListener("click", () => {
  state.selectedProjects = new Set(state.rawProjects);
  renderProjectList();
  refreshDashboard();
});
dom.clearProjects.addEventListener("click", () => {
  state.selectedProjects.clear();
  renderProjectList();
  refreshDashboard();
});
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
    const files = [];

    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".txt")) {
        files.push(entry);
      }
    }

    await consumeFileHandles(files);
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
  setStatus("兼容模式读取中...");

  await consumePlainFiles(files);
}

async function consumeFileHandles(handles) {
  state.totalFiles = handles.length;
  updateProgress();

  for (const handle of handles) {
    const file = await handle.getFile();
    await parseTextFile(file.name, await file.text());
    state.processedFiles += 1;
    updateProgress();
  }

  finalizeLoad();
}

async function consumePlainFiles(files) {
  state.totalFiles = files.length;
  updateProgress();

  for (const file of files) {
    await parseTextFile(file.name, await file.text());
    state.processedFiles += 1;
    updateProgress();
  }

  finalizeLoad();
}

async function parseTextFile(filename, content) {
  const toolName = filename.replace(/\.txt$/i, "");
  state.tools.add(toolName);

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split(",").map((segment) => segment.trim());
    if (parts.length < 5) {
      state.badLineCount += 1;
      continue;
    }

    const [user, startRaw, projectId, endRaw, stateRaw] = parts;
    const startTime = parseTimestamp(startRaw);
    const endTime = parseTimestamp(endRaw);
    const normalizedState = (stateRaw || "").toLowerCase();

    if (!user || !projectId || !startTime || !endTime) {
      state.badLineCount += 1;
      continue;
    }

    const durationMs = endTime.getTime() - startTime.getTime();
    if (durationMs < 0) {
      state.badLineCount += 1;
      continue;
    }

    const isSuccess = normalizedState === "success";
    const isFail = normalizedState === "fail";

    if (!isSuccess && !isFail) {
      state.badLineCount += 1;
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

    state.records.push(record);
    state.rawProjects.add(projectId);
  }
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
  state.rawProjects = new Set();
  state.selectedProjects = new Set();
  state.tools = new Set();
  state.badLineCount = 0;
  state.totalFiles = 0;
  state.processedFiles = 0;
  dom.folderInput.value = "";
  clearToolFilter();
}

function clearToolFilter() {
  dom.toolFilter.innerHTML = '<option value="ALL">全部工具</option>';
}

function finalizeLoad() {
  state.selectedProjects = new Set(state.rawProjects);
  populateToolFilter();
  renderProjectList();
  refreshDashboard();
  setStatus(`加载完成，共读取 ${state.totalFiles} 个文件。`);
}

function populateToolFilter() {
  clearToolFilter();
  const tools = Array.from(state.tools).sort();
  for (const tool of tools) {
    const option = document.createElement("option");
    option.value = tool;
    option.textContent = tool;
    dom.toolFilter.appendChild(option);
  }
}

function renderProjectList() {
  const keyword = dom.projectSearch.value.trim().toLowerCase();
  const projects = Array.from(state.rawProjects)
    .sort()
    .filter((project) => project.toLowerCase().includes(keyword));

  if (projects.length === 0) {
    dom.projectList.classList.add("empty");
    dom.projectList.textContent = "无匹配项目";
    return;
  }

  dom.projectList.classList.remove("empty");
  dom.projectList.innerHTML = "";

  for (const project of projects) {
    const label = document.createElement("label");
    label.className = "project-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedProjects.has(project);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedProjects.add(project);
      } else {
        state.selectedProjects.delete(project);
      }
      refreshDashboard();
    });

    const text = document.createElement("span");
    text.textContent = project;

    label.appendChild(checkbox);
    label.appendChild(text);
    dom.projectList.appendChild(label);
  }
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
  const tool = dom.toolFilter.value;

  return state.records.filter((record) => {
    if (state.selectedProjects.size > 0 && !state.selectedProjects.has(record.projectId)) {
      return false;
    }

    if (tool !== "ALL" && record.tool !== tool) {
      return false;
    }

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

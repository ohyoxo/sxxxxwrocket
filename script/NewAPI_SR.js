/* ===== Shadowrocket 兼容垫片 ===== */
if (typeof $notify === 'undefined') {
  var $notify = function(title, subtitle, body) {
    $notification.post(title, subtitle || '', body || '');
  };
}

if (typeof $prefs === 'undefined') {
  var $prefs = {
    valueForKey: function(key) {
      return $persistentStore.read(key);
    },
    setValueForKey: function(value, key) {
      return $persistentStore.write(value, key);
    }
  };
}

if (typeof $task === 'undefined') {
  var $task = {
    fetch: function(request) {
      return new Promise(function(resolve, reject) {
        var method = (request.method || 'GET').toUpperCase();
        var options = {
          url: request.url,
          headers: request.headers || {},
          body: request.body || ''
        };
        var cb = function(error, response, data) {
          if (error) {
            reject({ error: error });
          } else {
            resolve({
              statusCode: response.status,
              headers: response.headers,
              body: data
            });
          }
        };
        if (method === 'POST') {
          $httpClient.post(options, cb);
        } else {
          $httpClient.get(options, cb);
        }
      });
    }
  };
}
/* ===== 垫片结束 ===== */

const HEADER_KEY_PREFIX = "UniversalCheckin_Headers";
const HOSTS_LIST_KEY = "UniversalCheckin_HostsList";
const isGetHeader = typeof $request !== "undefined";

const NEED_KEYS = [
  "Host",
  "User-Agent",
  "Accept",
  "Accept-Language",
  "Accept-Encoding",
  "Origin",
  "Referer",
  "Cookie",
  "new-api-user",
  "Content-Type" // 修复：新增抓取 Content-Type
];

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function getSavedHosts() {
  try {
    if (typeof $prefs === "undefined") return [];
    const raw = $prefs.valueForKey(HOSTS_LIST_KEY);
    if (!raw) return [];
    const hosts = safeJsonParse(raw) || [];
    return Array.isArray(hosts) ? hosts.filter(h => h && typeof h === "string") : [];
  } catch (e) { console.log("[NewAPI] Error reading saved hosts:", e); return []; }
}

function addHostToList(host) {
  try {
    if (typeof $prefs === "undefined") return;
    const hosts = getSavedHosts();
    if (!hosts.includes(host)) {
      hosts.push(host);
      $prefs.setValueForKey(JSON.stringify(hosts), HOSTS_LIST_KEY);
      console.log("[NewAPI] Updated hosts list:", hosts.join(", "));
    }
  } catch (e) { console.log("[NewAPI] Error adding host to list:", e); }
}

function addAccountToHost(host, account) {
  try {
    if (typeof $prefs === "undefined" || !account || !account.trim()) return;
    const accountsKey = `${HEADER_KEY_PREFIX}:Accounts:${host}`;
    const raw = $prefs.valueForKey(accountsKey);
    const accounts = safeJsonParse(raw) || [];
    if (!accounts.includes(account)) {
      accounts.push(account);
      $prefs.setValueForKey(JSON.stringify(accounts), accountsKey);
      console.log(`[NewAPI] Account added to ${host}:`, account);
    }
  } catch (e) { console.log("[NewAPI] Error adding account to host:", e); }
}

function getAccountsForHost(host) {
  try {
    if (typeof $prefs === "undefined") return [""];
    const accountsKey = `${HEADER_KEY_PREFIX}:Accounts:${host}`;
    const raw = $prefs.valueForKey(accountsKey);
    const accounts = safeJsonParse(raw) || [];
    return accounts.length > 0 ? accounts : [""];
  } catch (e) { console.log("[NewAPI] Error reading accounts:", e); return [""]; }
}

function pickNeedHeaders(src = {}) {
  const dst = {};
  const lowerMap = {};
  for (const k of Object.keys(src || {})) lowerMap[String(k).toLowerCase()] = src[k];
  const get = (name) => src[name] ?? lowerMap[String(name).toLowerCase()];
  for (const k of NEED_KEYS) {
    const v = get(k);
    if (v !== undefined) dst[k] = v;
  }
  return dst;
}

function headerKeyForHost(host, account) {
  if (account && account.trim()) return `${HEADER_KEY_PREFIX}:${host}:${account}`;
  return `${HEADER_KEY_PREFIX}:${host}`;
}

function getHostFromRequest() {
  const h = ($request && $request.headers) || {};
  const host = h.Host || h.host;
  if (host) return String(host).trim();
  try { const u = new URL($request.url); return u.hostname; } catch (_) { return ""; }
}

function parseArgs(str) {
  const out = {};
  if (!str) return out;
  const s = String(str).trim();
  if (!s) return out;
  for (const part of s.split("&")) {
    const seg = part.trim();
    if (!seg) continue;
    const idx = seg.indexOf("=");
    if (idx === -1) { out[decodeURIComponent(seg)] = ""; }
    else {
      out[decodeURIComponent(seg.slice(0, idx))] = decodeURIComponent(seg.slice(idx + 1));
    }
  }
  return out;
}

function originFromHost(host) { return `https://${host}`; }
function refererFromHost(host) { return `https://${host}/console/personal`; }

function notifyTitleForHost(host, account) {
  let siteName = host;
  try {
    let name = host.replace(/^www\./, "");
    const parts = name.split(".");
    name = parts[0].trim();
    if (!name) name = parts[1] || host;
    name = name.replace(/[-_]api$/i,"").replace(/[-_]service$/i,"").replace(/[-_]app$/i,"").replace(/^api[-_]/i,"");
    siteName = name.toUpperCase() || host.toUpperCase();
  } catch (_) {}
  return account && account.trim() ? `${siteName}(${account})` : siteName;
}

if (isGetHeader) {
  const allHeaders = $request.headers || {};
  const host = getHostFromRequest();
  const picked = pickNeedHeaders(allHeaders);

  if (!host || !picked || !picked.Cookie || !picked["new-api-user"]) {
    console.log("[NewAPI] header capture failed:", JSON.stringify(allHeaders));
    $notify("通用签到","未抓到关键信息","请在触发 /api/user/self 请求时抓包（需要包含 Cookie 和 new-api-user）。");
    $done({});
  }

  const account = (picked["new-api-user"] || "").trim();
  const key = headerKeyForHost(host, account);
  const ok = $prefs.setValueForKey(JSON.stringify(picked), key);
  if (ok) {
    addHostToList(host);
    if (account) addAccountToHost(host, account);
  }
  const title = notifyTitleForHost(host, account);
  console.log(`[NewAPI] ${title} | 参数保存 | 已保存 ${Object.keys(picked).length} 个字段`);
  $notify(ok ? `${title} 参数获取成功` : `${title} 参数保存失败`, "", ok ? "后续将用于自动签到。" : "写入本地存储失败。");
  $done({});

} else {
  const args = parseArgs(typeof $argument !== "undefined" ? $argument : "");
  const onlyHost = (args.host || args.hostname || "").trim();
  const hostsToRun = onlyHost ? [onlyHost] : getSavedHosts();

  if (!onlyHost && hostsToRun.length === 0) {
    console.log("[NewAPI] No saved hosts found.");
    $notify("通用签到","无可用站点","请先抓包保存至少一个站点的 /api/user/self 请求头。");
    $done();
  }

  const doCheckin = async (host, account = "") => {
    const key = headerKeyForHost(host, account);
    const raw = $prefs.valueForKey(key);
    const title = notifyTitleForHost(host, account);
    
    if (!raw) {
      $notify(title, "缺少参数", "请先抓包保存一次 /api/user/self 的请求头。");
      return;
    }
    const savedHeaders = safeJsonParse(raw);
    if (!savedHeaders) {
      $notify(title, "参数异常", "已保存的请求头解析失败，请重新抓包保存。");
      return;
    }
    
    // 修复点 1：移除强制 Host 注入，防止 SNI 冲突引发 Example Domain 错误；加入 Content-Type 声明
    const headers = {
      Accept: savedHeaders.Accept || "application/json, text/plain, */*",
      "Accept-Language": savedHeaders["Accept-Language"] || "zh-CN,zh-Hans;q=0.9",
      "Accept-Encoding": savedHeaders["Accept-Encoding"] || "gzip, deflate, br",
      Origin: savedHeaders.Origin || originFromHost(host),
      Referer: savedHeaders.Referer || refererFromHost(host),
      "User-Agent": savedHeaders["User-Agent"] || "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      Cookie: savedHeaders.Cookie || "",
      "new-api-user": savedHeaders["new-api-user"] || "",
      "Content-Type": savedHeaders["Content-Type"] || "application/json",
    };

    // 封装请求方法
    const sendRequest = (path) => {
      return $task.fetch({ 
        url: `https://${host}${path}`, 
        method: "POST", 
        headers: headers, 
        body: "{}"  // 修复点 2：传入 {} 空 JSON 而非空字符串，避免 Gin 框架拦截
      });
    };

    try {
      let resp = await sendRequest("/api/user/checkin");
      let obj = safeJsonParse(resp.body || "") || {};

      // 修复点 3：遇到 Invalid URL 时，自动尝试部分面板使用的 /api/user/sign 接口
      if (resp.statusCode === 404 || (obj.error && obj.error.message && obj.error.message.includes("Invalid URL"))) {
        console.log(`[NewAPI] ${title} /api/user/checkin 失败，尝试回退接口 /api/user/sign`);
        const fallbackResp = await sendRequest("/api/user/sign");
        if (fallbackResp.statusCode !== 404) {
          resp = fallbackResp;
          obj = safeJsonParse(resp.body || "") || {};
        }
      }

      const status = resp.statusCode;
      const success = Boolean(obj.success);
      const message = obj.message ? String(obj.message) : (obj.error && obj.error.message ? String(obj.error.message) : "");
      const checkinDate = obj?.data?.checkin_date ? String(obj.data.checkin_date) : "";
      const quotaAwarded = obj?.data?.quota_awarded !== undefined ? String(obj.data.quota_awarded) : "";
      
      // 修复点 4：拦截代理/网络抽风返回的 HTML 内容，避免占满屏幕
      let rawBody = resp.body || "";
      if (rawBody.toLowerCase().includes("<!doctype html>") || rawBody.toLowerCase().includes("<html")) {
          rawBody = "返回了意外的网页(代理拦截或CDN异常)，请检查节点连通性。";
      } else if (rawBody.length > 150) {
          rawBody = rawBody.substring(0, 150) + "...";
      }

      if (status === 401 || status === 403) {
        $notify(title, "登录失效", `HTTP ${status}，请重新抓包保存 Cookie。`);
      } else if (status >= 200 && status < 300) {
        if (success) {
          let content = checkinDate ? `日期：${checkinDate}` : "签到成功";
          if (quotaAwarded) content += `\n获得：${quotaAwarded}`;
          $notify(title, "签到成功", content);
        } else {
          $notify(title, "签到失败", message || rawBody || `HTTP ${status}`);
        }
      } else {
        $notify(title, `接口异常 ${status}`, message || rawBody);
      }
    } catch (reason) {
      const err = reason?.error ? String(reason.error) : String(reason || "");
      $notify(title, "网络错误", err);
    }
  };

  (async () => {
    for (const h of hostsToRun) {
      const accounts = getAccountsForHost(h);
      for (const acc of accounts) { await doCheckin(h, acc); }
    }
    $done();
  })();
}

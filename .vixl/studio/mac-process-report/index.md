---
title: Mac Process Report
subtitle: System snapshot for aidanhibbard — $(date '+%Y-%m-%d %H:%M')
---

# Mac Process Report

System snapshot collected at **21:12** on a macOS machine running for **2 hours 56 minutes**.

::metrics
---
items:
  - label: CPU
    value: "Apple M3 Max (14 cores)"
    tone: neutral
  - label: RAM
    value: "36 GB"
    tone: neutral
  - label: Load Avg (1/5/15m)
    value: "23.80 / 12.31 / 6.78"
    tone: negative
  - label: Memory Free
    value: "88%"
    tone: positive
  - label: Swap Used
    value: "0 MB"
    tone: positive
---
::

## Hardware Overview

| Component | Detail |
| --- | --- |
| CPU | Apple M3 Max, 14 logical cores |
| Physical RAM | 36 GB (35 GB usable) |
| Swap | Not in use (0 MB) |
| Uptime | 2h 56m |

## Load Analysis

The load averages are **significantly elevated**. On a 14-core processor, the baseline idle load is ~0. Each core can handle one unit of load; a load of 23.80 means the system is handling work equivalent to roughly **24 full cores** — well beyond its capacity. This explains why the 5-minute average (12.31) is still much lower than the 1-minute (23.80): the spike is recent and accelerating.

::callout{tone="warning" title="High CPU Load"}
Load average of 23.80 on a 14-core machine indicates heavy concurrent workload. The rapid climb from 6.78 (15m) to 23.80 (1m) suggests a burst of activity started within the last few minutes.
::

## Top Processes by Open File Handles

`ps` and `top` are blocked by macOS privacy restrictions, so process counts were derived from open file descriptors via `lsof`. This is a strong proxy for process activity.

::table
---
title: Most Active Processes (by open file handle count)
columns:
  - key: rank
    label: Rank
  - key: process
    label: Process
  - key: handles
    label: Open Handles
rows:
  - rank: 1
    process: Firefox
    handles: "537"
  - rank: 2
    process: Cursor
    handles: "421"
  - rank: 3
    process: com.apple (system)
    handles: "243"
  - rank: 4
    process: Discord
    handles: "215"
  - rank: 5
    process: UserEventAgent
    handles: "154"
  - rank: 6
    process: plugin-container
    handles: "148"
  - rank: 7
    process: NotificationAgent
    handles: "145"
  - rank: 8
    process: Messages
    handles: "140"
  - rank: 9
    process: GitHub Desktop
    handles: "138"
  - rank: 10
    process: node
    handles: "117"
---
::

## Memory Breakdown

| Metric | Value |
| --- | --- |
| Active pages | 1,013,632 |
| Inactive pages | 992,346 |
| Wired down | 215,981 |
| Compressor pages | 45,804 |
| System free | 88% |

Memory pressure is **low** — 88% of RAM is free and no swap is being used. The system is not memory-constrained; the load spike is CPU-bound.

## Key Takeaways

1. **CPU is the bottleneck.** Load is nearly 2x the core count, but memory is barely touched.
2. **Firefox + Cursor are the heaviest processes** by open handles (958 combined). Firefox alone with 537 handles — likely many tabs open.
3. **Node.js** (117 handles) and **Discord** (215) are also contributing meaningfully.
4. **No swap pressure.** The M3 Max has plenty of RAM headroom.

To investigate the CPU spike further, you can run `top -u aidanhibbard` or `htop` in Terminal for real-time per-process CPU usage — those commands require the same permission restrictions but will work directly from an interactive terminal session.
/**
 * Browser half of the attention-reminder bundle.
 *
 * Two sources, both already in the page:
 *
 *   `uiSession.sessionStatus` — the per-Session UI status the sidebar's dots are
 *   drawn from: `running`, `pendingInteraction`, `completionUnread`.
 *   `sessions.list` — the Session catalog rows, used for the session's own title
 *   and for telling subagent rows from rows the user can return to.
 *
 * Comparing successive status snapshots yields the two moments worth calling the
 * user back. Both arrive over the page's existing connection, so the reminder
 * still fires while the window is minimized — a timer-based poll would be
 * throttled by the browser in a hidden window.
 *
 * A waiting request is repeated while it stays unhandled and the window stays in
 * the background; a finished turn is announced once. Each state owns its own
 * sound slot, either the synthesized chime below or one audio file the user
 * replaces it with: a replacement is decoded onto the same unlocked AudioContext
 * and stored in IndexedDB, so the reminder keeps working while minimized.
 *
 * The preferences are two rows in Settings > General, the additive seat for a
 * feature-owned preference: `settings.general.item`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-harness-orb',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Page-local switches; the reminder has no Host configuration. */
    const STORAGE_KEY = 'dsh-harness-orb.reminders'
    const VOLUME_KEY = 'dsh-harness-orb.repeat-volume'
    /** Gain per announcement stage: first, first repeat, last reminder. */
    const VOLUME_STEPS = [1, 1.5, 2]
    /** Tag prefix; kind and session keep two different reminders from replacing each other. */
    const NOTIFICATION_TAG = 'dsh-harness-orb'
    /** Two reminders closer together than this share one chime. */
    const CHIME_GAP_MS = 350
    /**
     * Repeat an unhandled waiting request after these gaps, then stop. A hidden
     * window throttles timers, so these are floors rather than exact instants.
     */
    const ESCALATION_DELAYS = [2 * 60 * 1000, 4 * 60 * 1000]
    /** A replacement longer than this is cut here, so a song cannot ring for minutes. */
    const SOUND_MAX_SECONDS = 5
    /** A dismissed notification prompt must not be re-opened on every later click. */
    const PERMISSION_ATTEMPTS = 2
    /** Custom sounds live in IndexedDB: no localStorage quota shared with preferences. */
    const SOUND_DB = 'dsh-harness-orb'
    const SOUND_STORE = 'sounds'
    const SOUND_MAX_BYTES = 4 * 1024 * 1024
    /** One configurable sound per reminder state. */
    const SOUND_SLOTS = ['done', 'approval', 'question']

    const STYLE = [
      // Setting-Cell geometry, shared with the shipped preference rows this row
      // sits beside (Language, Appearance, Composer Enter): a 48px gutter keeps
      // the label clear of its control, and narrow panels squeeze the label only.
      '.dsh-orb-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px;',
      '  padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }',
      '.dsh-orb-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 48px; }',
      '@media (max-width: 767px) {',
      "  html:not([data-windows-titlebar]):not([data-platform='darwin']) .dsh-orb-text { padding-right: 16px; }",
      '}',
      '.dsh-orb-title { font-size: 14px; font-weight: 400; line-height: 22px; color: var(--dsw-alias-label-primary); }',
      '.dsh-orb-desc { font-size: 12px; font-weight: 400; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }',
      '.dsh-orb-desc[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-orb-option { display: flex; align-items: center; gap: 8px; margin-top: 2px;',
      '  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }',
      '.dsh-orb-actions { display: flex; align-items: center; gap: 8px; flex: none; margin-left: auto; }',
      // A native select paints its own light box on Windows, which turns into
      // white-on-white once the theme makes the label light. Strip the native
      // appearance and give it the same pill geometry as the shipped preference
      // selectors (36px, 14/22, --dsw-radius-md, module-platform surface).
      '.dsh-orb-select-wrap { position: relative; display: inline-flex; align-items: center; flex: none; }',
      '.dsh-orb-select { box-sizing: border-box; display: inline-flex; align-items: center;',
      '  height: 36px; padding: 0 26px 0 14px; border: none;',
      '  border-radius: var(--dsw-radius-md); cursor: pointer;',
      '  appearance: none; -webkit-appearance: none;',
      '  background-color: var(--dsw-alias-bg-module-platform);',
      '  font: inherit; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }',
      '.dsh-orb-select option { background-color: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }',
      '.dsh-orb-chevron { position: absolute; right: 10px; display: flex; pointer-events: none;',
      '  color: var(--dsw-alias-label-secondary); }',
      '.dsh-orb-action { box-sizing: border-box; height: 36px; padding: 0 12px; border: none;',
      '  border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer;',
      '  font: inherit; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }',
      '@media (hover: hover) {',
      '  .dsh-orb-action:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '  .dsh-orb-select:hover {',
      '    background-color: color-mix(in srgb, var(--dsw-alias-bg-module-platform), var(--dsw-alias-label-primary) 6%); }',
      '}',
      '.dsh-orb-action:active { background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover)); }',
      // Switch geometry and colours follow the shipped Switch control: a 36x20
      // track, a 16px thumb 2px in, and the on-state thumb in the foreground tone.
      '.dsh-orb-switch { box-sizing: border-box; position: relative; flex: none; width: 36px; height: 20px;',
      '  padding: 0; border: none; border-radius: 999px; cursor: pointer;',
      '  background: var(--dsw-alias-border-l3); transition: background-color 120ms ease; }',
      '.dsh-orb-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }',
      '.dsh-orb-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;',
      '  background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease; }',
      '.dsh-orb-switch[aria-checked="true"] .dsh-orb-knob {',
      '  transform: translateX(16px); background: var(--dsw-alias-label-primary-foreground); }',
      '.dsh-orb-action:focus-visible, .dsh-orb-select:focus-visible, .dsh-orb-switch:focus-visible {',
      '  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));',
      '  outline-offset: 2px; }',
    ].join('\n')

    const COPY = {
      zh: {
        rowTitle: '完成与等待提醒',
        rowDescription: '回合跑完、或 DSH 在等你批准 / 回答时，只要窗口不在前台就响铃并弹出系统通知。',
        rowRepeatNote: '没人处理的审批 / 提问会在约 2 分钟、6 分钟后再各提醒一次；窗口一回到前台就停。',
        soundOnly: '系统通知不可用，目前只响铃。',
        soundTitle: '提醒提示音',
        soundSlotLabel: '提示音档位',
        soundStateDone: '完成',
        soundStateApproval: '待审批',
        soundStateQuestion: '待回答',
        soundNowDefaultFor: (state) => '当前（' + state + '）：内置合成铃音（无音频文件）',
        soundNowFor: (state, name) => '当前（' + state + '）：' + name,
        soundPick: '选择文件…',
        soundPreview: '试听',
        soundReset: '恢复默认',
        soundSaved: '已换成这个文件。',
        soundSavedLong: '已换成这个文件，只播前 5 秒。',
        soundRemoved: '已恢复默认提示音。',
        soundUndecodable: '这个文件解码不了，仍用原来的提示音。',
        soundTooBig: '文件太大，上限 4 MB。',
        soundDiskFailed: '没能存到本机（浏览器可能禁用了存储），刷新后会回到之前的提示音。',
        repeatAgain: '（再次提醒）',
        repeatLast: '（最后一次提醒）',
        stillWaiting: '（仍在等你处理）',
        repeatSoundTitle: '再次提醒时加大音量',
        repeatSoundDesc: '第 2、3 次提醒分别用约 1.5 倍、2 倍的音量，方便从别的声源里听出来；关掉则每次音量相同。',
        doneTitle: '回合完成',
        doneBody: (session) => '「' + session + '」这一轮已经跑完了。',
        approvalTitle: '等待你的批准',
        approvalBody: (session, tool) => tool
          ? '「' + session + '」的「' + tool + '」调用在等你批准。'
          : '「' + session + '」有工具调用在等你批准。',
        questionTitle: '等待你的回答',
        questionBody: (session) => '「' + session + '」在等你回答问题。',
        attentionTitle: '需要你处理',
        attentionBody: (session) => '「' + session + '」在等你处理。',
      },
      en: {
        rowTitle: 'Turn and waiting reminders',
        rowDescription: 'When a turn finishes, or DSH is waiting for your approval or answer, chime and post a system notification whenever the window is in the background.',
        rowRepeatNote: 'An unhandled approval or question is repeated after about 2 and 6 minutes; it stops once the window is in front again.',
        soundOnly: 'No system notification available; chime only.',
        soundTitle: 'Reminder sound',
        soundSlotLabel: 'Reminder sound slot',
        soundStateDone: 'Finished',
        soundStateApproval: 'Approval',
        soundStateQuestion: 'Question',
        soundNowDefaultFor: (state) => 'Current (' + state + '): built-in synthesized chime (no audio file)',
        soundNowFor: (state, name) => 'Current (' + state + '): ' + name,
        soundPick: 'Choose file…',
        soundPreview: 'Preview',
        soundReset: 'Use default',
        soundSaved: 'Now using this file.',
        soundSavedLong: 'Now using this file; only its first 5 seconds play.',
        soundRemoved: 'Back to the default chime.',
        soundUndecodable: 'That file could not be decoded; the previous sound stays.',
        soundTooBig: 'That file is too large (4 MB limit).',
        soundDiskFailed: 'Could not write to this browser\'s storage; the previous sound returns after a reload.',
        repeatAgain: ' (reminder again)',
        repeatLast: ' (last reminder)',
        stillWaiting: ' (still waiting for you)',
        repeatSoundTitle: 'Louder on repeat reminders',
        repeatSoundDesc: 'The second and third reminders play at about 1.5x and 2x volume so they cut through other sound; turn this off to keep every reminder at the same level.',
        doneTitle: 'Turn finished',
        doneBody: (session) => '"' + session + '" finished its turn.',
        approvalTitle: 'Waiting for your approval',
        approvalBody: (session, tool) => tool
          ? 'The "' + tool + '" call in "' + session + '" is waiting for your decision.'
          : 'A tool call in "' + session + '" is waiting for your decision.',
        questionTitle: 'Waiting for your answer',
        questionBody: (session) => '"' + session + '" is waiting for your answer.',
        attentionTitle: 'Needs your attention',
        attentionBody: (session) => '"' + session + '" is waiting for you.',
      },
    }

    const settings = {
      enabled: readFlag(STORAGE_KEY, true),
      escalateVolume: readFlag(VOLUME_KEY, true),
    }
    /** One decoded sound per slot; an absent buffer means the synthesized chime. */
    const sounds = {}
    for (const slot of SOUND_SLOTS) sounds[slot] = { buffer: undefined, name: '', gain: 1 }
    const soundWatchers = new Set()
    const copyWatchers = new Set()
    /** sessionId -> { interactionKey, step, timer }, one live repeat chain per Session. */
    const escalations = new Map()
    let copy = COPY.en
    let hostContext
    let statusSource
    let audio
    let playing
    let permissionAttempts = 0
    let lastChimeAt = 0

    function readFlag(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        return raw === null ? fallback : raw === '1'
      } catch (_error) {
        return fallback
      }
    }

    function writeFlag(key, value) {
      try {
        window.localStorage.setItem(key, value ? '1' : '0')
      } catch (_error) {
        /* A blocked storage write only costs the preference across reloads. */
      }
    }

    /** The active locale id lives on `LocaleSnapshot.active`. */
    function copyFor(ctx) {
      let id = ''
      try {
        const locale = ctx.get('locale')
        if (locale && typeof locale.getLocale === 'function') {
          const snapshot = locale.getLocale()
          const value = snapshot && snapshot.active
          if (typeof value === 'string') id = value.toLowerCase()
        }
      } catch (_error) {
        id = ''
      }
      // Only Chinese has its own table; every other locale reads English.
      return id.indexOf('zh') === 0 ? COPY.zh : COPY.en
    }

    function notifyCopy() {
      copyWatchers.forEach((watcher) => {
        try {
          watcher()
        } catch (_error) {
          /* One listener's failure must not stop the others. */
        }
      })
    }

    function shortId(sessionId) {
      return typeof sessionId === 'string' ? sessionId.slice(-6) : ''
    }

    /** The reminder exists for the case where the user is not looking at the app. */
    function worthCallingAway() {
      if (!settings.enabled) return false
      try {
        return document.hidden || !document.hasFocus()
      } catch (_error) {
        return true
      }
    }

    function audioContext() {
      if (audio !== undefined) return audio
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (typeof Ctor !== 'function') {
        audio = null
        return audio
      }
      try {
        audio = new Ctor()
      } catch (_error) {
        audio = null
      }
      return audio
    }

    /** Chromium starts a context suspended until a real user gesture arrives. */
    function unlockAudio() {
      const context = audioContext()
      if (context && context.state === 'suspended') {
        const resumed = context.resume()
        if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {})
      }
    }

    function tone(context, frequency, startAt, duration, peak) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, startAt)
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + duration + 0.02)
    }

    /** A rising pair for a finished turn, a more insistent triple for a wait. */
    function playSynth(context, slot, volume) {
      const gain = typeof volume === 'number' && volume > 0 ? volume : 1
      const at = context.currentTime + 0.02
      if (slot === 'approval') {
        tone(context, 1046.5, at, 0.16, 0.16 * gain)
        tone(context, 784, at + 0.14, 0.24, 0.16 * gain)
        tone(context, 1046.5, at + 0.3, 0.2, 0.12 * gain)
        return
      }
      if (slot === 'question') {
        tone(context, 880, at, 0.18, 0.14 * gain)
        tone(context, 1174.7, at + 0.16, 0.26, 0.12 * gain)
        return
      }
      tone(context, 659.25, at, 0.18, 0.14 * gain)
      tone(context, 987.77, at + 0.16, 0.3, 0.12 * gain)
    }

    /** One replacement at a time: a new reminder must not stack on the previous. */
    function stopPlaying() {
      const current = playing
      playing = undefined
      if (current === undefined) return
      try {
        current.stop()
      } catch (_error) {
        /* An already ended source refuses a second stop. */
      }
    }

    /** Play one slot's replacement; false when it holds none or cannot run. */
    function playSample(context, slot, volume) {
      const entry = sounds[slot]
      if (!entry || !entry.buffer) return false
      const factor = typeof volume === 'number' && volume > 0 ? volume : 1
      try {
        stopPlaying()
        const source = context.createBufferSource()
        const gain = context.createGain()
        gain.gain.value = Math.min(1, entry.gain * factor)
        source.buffer = entry.buffer
        source.connect(gain).connect(context.destination)
        source.onended = () => {
          if (playing === source) playing = undefined
        }
        const duration = typeof entry.buffer.duration === 'number' ? entry.buffer.duration : 0
        const seconds = duration > 0 ? Math.min(duration, SOUND_MAX_SECONDS) : 0
        if (seconds > 0) source.start(0, 0, seconds)
        else source.start()
        playing = source
        return true
      } catch (_error) {
        stopPlaying()
        return false
      }
    }

    /** Every waiting interaction shares the approval slot; only a finish differs. */
    function slotOf(kind) {
      if (kind === 'done') return 'done'
      if (kind === 'question') return 'question'
      return 'approval'
    }

    function playSlot(slot, volume) {
      const context = audioContext()
      if (!context) return
      unlockAudio()
      if (playSample(context, slot, volume)) return
      playSynth(context, slot, volume)
    }

    function playChime(kind, volume) {
      const now = Date.now()
      if (now - lastChimeAt < CHIME_GAP_MS) return
      lastChimeAt = now
      playSlot(slotOf(kind), volume)
    }

    /** Repeat reminders get louder when the user asks for it; the first never does. */
    function volumeFor(stage) {
      if (!settings.escalateVolume) return 1
      const factor = VOLUME_STEPS[stage]
      return factor === undefined ? 1 : factor
    }

    /** A deliberate preview always speaks, whether or not reminders are on. */
    function previewSlot(slot, volume) {
      lastChimeAt = 0
      playSlot(slot, volume)
    }

    function notificationPermission() {
      if (typeof window.Notification !== 'function') return 'unsupported'
      return window.Notification.permission
    }

    /**
     * Ask on a gesture only while the reminder is on, and give up after a couple
     * of dismissals instead of re-opening the prompt on every later click.
     */
    function requestNotificationPermission() {
      if (!settings.enabled) return
      if (notificationPermission() !== 'default') return
      if (permissionAttempts >= PERMISSION_ATTEMPTS) return
      permissionAttempts += 1
      try {
        const pending = window.Notification.requestPermission()
        if (pending && typeof pending.catch === 'function') pending.catch(() => {})
      } catch (_error) {
        permissionAttempts = PERMISSION_ATTEMPTS
      }
    }

    function showNotification(title, body, onClick, tag) {
      if (notificationPermission() !== 'granted') return false
      try {
        const notification = new window.Notification(title, {
          body,
          tag,
          silent: true,
        })
        if (typeof onClick === 'function') {
          notification.onclick = () => {
            try {
              window.focus()
              onClick()
            } finally {
              try {
                notification.close()
              } catch (_error) {
                /* The toast may already be gone. */
              }
            }
          }
        }
        return true
      } catch (_error) {
        return false
      }
    }

    /** Bring the session the reminder is about back into view. */
    function revealSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      try {
        const uiWorkspace = hostContext && hostContext.get('uiWorkspace')
        if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
          uiWorkspace.openSession(sessionId)
        }
      } catch (_error) {
        /* Focusing the window is still useful without navigation. */
      }
    }

    /** Catalog rows carry the host-side title and the subagent origin. */
    function sessionList() {
      try {
        const sessions = hostContext && hostContext.get('sessions')
        const list = sessions && sessions.list
        const snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined
        return snapshot && snapshot.byId ? snapshot : undefined
      } catch (_error) {
        return undefined
      }
    }

    function sessionRow(sessionId) {
      const list = sessionList()
      return list ? list.byId[sessionId] : undefined
    }

    function sessionLabel(sessionId) {
      const row = sessionRow(sessionId)
      const title = row && typeof row.displayTitle === 'string' ? row.displayTitle.trim() : ''
      return title === '' ? '#' + shortId(sessionId) : title
    }

    /** A subagent row, or a row the sidebar does not list, cannot be returned to. */
    function notifiable(sessionId) {
      const list = sessionList()
      if (!list) return true
      const row = list.byId[sessionId]
      if (row && row.origin === 'subagent') return false
      if (list.phase === 'ready' && Array.isArray(list.ids) && list.ids.indexOf(sessionId) < 0) return false
      return true
    }

    /** `note` is appended to the body: a repeat label, or '' for the first announcement. */
    function deliver(kind, sessionId, interaction, note, volume) {
      if (!worthCallingAway()) return
      playChime(kind, volume)
      const label = sessionLabel(sessionId)
      const reveal = () => revealSession(sessionId)
      const tag = NOTIFICATION_TAG + ':' + kind + ':' + String(sessionId)
      const suffix = typeof note === 'string' ? note : ''
      if (kind === 'approval') {
        showNotification(copy.approvalTitle, copy.approvalBody(label, interaction && interaction.toolName) + suffix, reveal, tag)
        return
      }
      if (kind === 'question') {
        showNotification(copy.questionTitle, copy.questionBody(label) + suffix, reveal, tag)
        return
      }
      if (kind === 'attention') {
        showNotification(copy.attentionTitle, copy.attentionBody(label) + suffix, reveal, tag)
        return
      }
      showNotification(copy.doneTitle, copy.doneBody(label) + suffix, reveal, tag)
    }

    function kindOf(interaction) {
      const kind = interaction && typeof interaction.kind === 'string' ? interaction.kind.toLowerCase() : ''
      if (kind.indexOf('approv') >= 0) return 'approval'
      if (kind.indexOf('question') >= 0 || kind.indexOf('ask') >= 0) return 'question'
      return 'attention'
    }

    /* ------------------------------------------------------------------- repeats */

    function stopEscalation(sessionId) {
      const record = escalations.get(sessionId)
      if (record === undefined) return
      escalations.delete(sessionId)
      if (record.timer !== undefined) {
        try {
          clearTimeout(record.timer)
        } catch (_error) {
          /* A timer that already fired needs no clear. */
        }
      }
    }

    function stopAllEscalations() {
      for (const sessionId of [...escalations.keys()]) stopEscalation(sessionId)
    }

    /** The request still waiting for this Session, read fresh at wake-up time. */
    function pendingOf(sessionId) {
      if (!statusSource) return undefined
      try {
        const snapshot = statusSource.getSnapshot()
        const status = snapshot && typeof snapshot.get === 'function' ? snapshot.get(sessionId) : undefined
        const pending = status && status.pendingInteraction
        return pending || undefined
      } catch (_error) {
        return undefined
      }
    }

    /**
     * Chase one unhandled request while the window stays in the background. The
     * chain re-reads the live status, so answering the request, a replacement
     * request, turning reminders off, or coming back to the window all end it.
     * `adopted` marks a chain armed for a request that was already waiting when
     * this page opened, which has never been announced here.
     */
    function scheduleEscalation(sessionId, interactionKey, step, adopted) {
      stopEscalation(sessionId)
      const delay = ESCALATION_DELAYS[step]
      if (delay === undefined) return
      const timer = setTimeout(() => {
        const record = escalations.get(sessionId)
        if (record === undefined || record.timer !== timer) return
        escalations.delete(sessionId)
        if (!settings.enabled) return
        const pending = pendingOf(sessionId)
        if (!pending || pending.key !== interactionKey) return
        if (!worthCallingAway()) return
        const note = step === 0
          ? (adopted ? copy.stillWaiting : copy.repeatAgain)
          : copy.repeatLast
        deliver(kindOf(pending), sessionId, pending, note, volumeFor(step + 1))
        scheduleEscalation(sessionId, interactionKey, step + 1, false)
      }, delay)
      escalations.set(sessionId, { interactionKey, step, timer })
    }

    /**
     * A page that opens onto a request that was already waiting — a reload, an
     * app restart — takes it over instead of ignoring it: the chain is armed so
     * walking away still rings, and a window that opens in the background hears
     * it at once. Without this, closing the app mid-approval would silence that
     * approval for good.
     */
    function adoptPending(snapshot) {
      if (!snapshot || typeof snapshot.forEach !== 'function') return
      snapshot.forEach((status, sessionId) => {
        if (!status || !notifiable(sessionId)) return
        const pending = status.pendingInteraction
        if (!pending || typeof pending.key !== 'string') return
        scheduleEscalation(sessionId, pending.key, 0, true)
        deliver(kindOf(pending), sessionId, pending, copy.stillWaiting)
      })
    }

    /**
     * Fire on the edges of the status projection, never on a steady state.
     * `completionUnread` alone cannot cover the session the main view holds —
     * the app clears it there — so the running edge is what catches a turn that
     * ended while the window was minimized.
     */
    function remind(before, after) {
      if (!after || typeof after.forEach !== 'function') return
      if (before && typeof before.forEach === 'function') {
        before.forEach((_status, sessionId) => {
          const still = typeof after.has === 'function' && after.has(sessionId)
          if (!still) stopEscalation(sessionId)
        })
      }
      after.forEach((status, sessionId) => {
        if (!status) return
        const prior = before && typeof before.get === 'function' ? before.get(sessionId) : undefined
        const pending = status.pendingInteraction
        const priorPending = prior && prior.pendingInteraction
        if (pending) {
          if (!notifiable(sessionId)) return
          if (!priorPending || priorPending.key !== pending.key) {
            deliver(kindOf(pending), sessionId, pending)
            scheduleEscalation(sessionId, pending.key, 0, false)
          }
          return
        }
        if (priorPending !== undefined) {
          // Answered or withdrawn: nothing left to chase, and no finish either.
          stopEscalation(sessionId)
          return
        }
        if (!notifiable(sessionId)) return
        const finished = prior !== undefined && prior.running === true && status.running === false
        const becameUnread = status.completionUnread === true
          && !(prior !== undefined && prior.completionUnread === true)
        if (finished || becameUnread) deliver('done', sessionId)
      })
    }

    /* ------------------------------------------------------------------ sound storage */

    function indexedDb() {
      return new Promise((resolve, reject) => {
        const factory = window.indexedDB
        if (!factory) {
          reject(new Error('indexedDB unavailable'))
          return
        }
        let request
        try {
          request = factory.open(SOUND_DB, 1)
        } catch (error) {
          reject(error)
          return
        }
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(SOUND_STORE)) db.createObjectStore(SOUND_STORE)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }

    function soundStore(mode, run) {
      return indexedDb().then((db) => new Promise((resolve, reject) => {
        let transaction
        try {
          transaction = db.transaction(SOUND_STORE, mode)
        } catch (error) {
          db.close()
          reject(error)
          return
        }
        const request = run(transaction.objectStore(SOUND_STORE))
        transaction.oncomplete = () => {
          db.close()
          resolve(request ? request.result : undefined)
        }
        transaction.onerror = () => {
          db.close()
          reject(transaction.error || (request && request.error) || new Error('sound store failed'))
        }
        transaction.onabort = () => {
          db.close()
          reject(transaction.error || new Error('sound store aborted'))
        }
      }))
    }

    function decodeSound(blob) {
      const context = audioContext()
      if (!context || typeof context.decodeAudioData !== 'function') {
        return Promise.reject(new Error('no AudioContext to decode with'))
      }
      return blob.arrayBuffer().then((data) => new Promise((resolve, reject) => {
        let settled = false
        const ok = (buffer) => { if (!settled) { settled = true; resolve(buffer) } }
        const fail = (error) => { if (!settled) { settled = true; reject(error || new Error('decode failed')) } }
        try {
          const pending = context.decodeAudioData(data, ok, fail)
          if (pending && typeof pending.then === 'function') pending.then(ok, fail)
        } catch (error) {
          fail(error)
        }
      }))
    }

    /**
     * Level a replacement against the synthesized chime, whose peaks sit near
     * 0.15: an arbitrary file must not be an order of magnitude louder.
     */
    function gainFor(buffer) {
      try {
        const data = buffer.getChannelData(0)
        let peak = 0
        for (let index = 0; index < data.length; index += 16) {
          const value = data[index] < 0 ? -data[index] : data[index]
          if (value > peak) peak = value
        }
        if (!(peak > 0)) return 1
        return Math.min(1, 0.32 / peak)
      } catch (_error) {
        return 1
      }
    }

    function setSoundSlot(slot, buffer, name) {
      const entry = sounds[slot]
      if (!entry) return
      entry.buffer = buffer
      entry.name = name || ''
      entry.gain = buffer ? gainFor(buffer) : 1
      soundWatchers.forEach((watcher) => {
        try {
          watcher()
        } catch (_error) {
          /* One listener's failure must not stop the others. */
        }
      })
    }

    function watchSound(watcher) {
      soundWatchers.add(watcher)
      return () => { soundWatchers.delete(watcher) }
    }

    /** Read back every replacement stored by an earlier page load. */
    function loadStoredSounds() {
      return Promise.all(SOUND_SLOTS.map(slot => soundStore('readonly', store => store.get(slot))
        .then((saved) => {
          if (!saved || !saved.blob) return undefined
          return decodeSound(saved.blob).then((buffer) => { setSoundSlot(slot, buffer, saved.name) })
        })
        .catch(() => undefined)))
    }

    /* -------------------------------------------------------------------------- UI */

    /** Re-render when the page's locale changes, so the rows follow it live. */
    function useLocaleTick() {
      const [, tick] = React.useState(0)
      React.useEffect(() => {
        const watcher = () => tick(value => value + 1)
        copyWatchers.add(watcher)
        return () => { copyWatchers.delete(watcher) }
      }, [])
    }

    function Styles() {
      return h('style', null, STYLE)
    }

    /** Settings > General row: the on/off switch. */
    function ReminderRow() {
      useLocaleTick()
      const [enabled, setEnabled] = React.useState(settings.enabled)
      const toggle = () => {
        const next = !settings.enabled
        settings.enabled = next
        writeFlag(STORAGE_KEY, next)
        setEnabled(next)
        unlockAudio()
        if (!next) {
          stopAllEscalations()
          return
        }
        requestNotificationPermission()
        previewSlot('done')
      }
      const hint = notificationPermission() === 'granted' ? '' : ' ' + copy.soundOnly
      return h(React.Fragment, null,
        h(Styles, { key: 'style' }),
        h('div', { key: 'row', className: 'dsh-orb-row' },
          h('div', { key: 'text', className: 'dsh-orb-text' },
            h('div', { className: 'dsh-orb-title' }, copy.rowTitle),
            h('div', { className: 'dsh-orb-desc' }, copy.rowDescription + hint),
            h('div', { className: 'dsh-orb-desc' }, copy.rowRepeatNote)),
          h('button', {
            key: 'switch',
            type: 'button',
            className: 'dsh-orb-switch',
            role: 'switch',
            'aria-checked': enabled,
            'aria-label': copy.rowTitle,
            onClick: toggle,
          }, h('span', { className: 'dsh-orb-knob' }))))
    }

    /** Settings > General row: one sound per state. */
    function SoundRow() {
      useLocaleTick()
      const [slot, setSlotId] = React.useState('done')
      const [status, setStatus] = React.useState(null)
      const [louder, setLouder] = React.useState(settings.escalateVolume)
      const [, refresh] = React.useState(0)
      const fileRef = React.useRef(null)
      React.useEffect(() => watchSound(() => refresh(value => value + 1)), [])

      const entry = sounds[slot] || sounds.done
      const stateName = slot === 'done'
        ? copy.soundStateDone
        : slot === 'question' ? copy.soundStateQuestion : copy.soundStateApproval

      const choose = () => {
        const input = fileRef.current
        if (input && typeof input.click === 'function') input.click()
      }

      const toggleLouder = () => {
        const next = !settings.escalateVolume
        settings.escalateVolume = next
        writeFlag(VOLUME_KEY, next)
        setLouder(next)
        unlockAudio()
        // Turning it on demonstrates the level the next repeat would use.
        if (next) previewSlot(slot, volumeFor(1))
      }

      const reset = () => {
        const target = slot
        setSoundSlot(target, undefined, '')
        soundStore('readwrite', store => store.delete(target))
          .then(
            () => setStatus({ text: copy.soundRemoved, tone: 'info' }),
            () => setStatus({ text: copy.soundDiskFailed, tone: 'error' }),
          )
      }

      const onPicked = (event) => {
        const input = event.target
        const file = input && input.files && input.files[0]
        if (input) input.value = ''
        if (!file) return
        const target = slot
        if (typeof file.size === 'number' && file.size > SOUND_MAX_BYTES) {
          setStatus({ text: copy.soundTooBig, tone: 'error' })
          return
        }
        decodeSound(file)
          .then(buffer => soundStore('readwrite', store => store.put({ blob: file, name: file.name }, target))
            .then(() => true, () => false)
            .then((persisted) => {
              setSoundSlot(target, buffer, file.name)
              const trimmed = (buffer.duration || 0) > SOUND_MAX_SECONDS
              if (!persisted) setStatus({ text: copy.soundDiskFailed, tone: 'error' })
              else setStatus({ text: trimmed ? copy.soundSavedLong : copy.soundSaved, tone: 'info' })
              // Picking a file is a deliberate request to hear it.
              previewSlot(target)
            }))
          .catch(() => { setStatus({ text: copy.soundUndecodable, tone: 'error' }) })
      }

      return h(React.Fragment, null,
        h(Styles, { key: 'style' }),
        h('div', { key: 'row', className: 'dsh-orb-row' },
          h('div', { key: 'text', className: 'dsh-orb-text' },
            h('div', { className: 'dsh-orb-title' }, copy.soundTitle),
            h('div', { className: 'dsh-orb-desc' },
              entry.name === '' ? copy.soundNowDefaultFor(stateName) : copy.soundNowFor(stateName, entry.name)),
            h('div', { key: 'repeat', className: 'dsh-orb-option' },
              h('span', null, copy.repeatSoundTitle),
              h('button', {
                type: 'button',
                className: 'dsh-orb-switch',
                role: 'switch',
                'aria-checked': louder,
                'aria-label': copy.repeatSoundTitle,
                title: copy.repeatSoundDesc,
                onClick: toggleLouder,
              }, h('span', { className: 'dsh-orb-knob' }))),
            status === null
              ? null
              : h('div', {
                className: 'dsh-orb-desc',
                'data-tone': status.tone,
                role: 'status',
              }, status.text)),
          h('div', { key: 'actions', className: 'dsh-orb-actions' },
            h('span', { key: 'slot', className: 'dsh-orb-select-wrap' },
              h('select', {
                className: 'dsh-orb-select',
                value: slot,
                'aria-label': copy.soundSlotLabel,
                onChange: (event) => { setSlotId(event.target.value); setStatus(null) },
              }, SOUND_SLOTS.map(id => h('option', { key: id, value: id },
                id === 'done'
                  ? copy.soundStateDone
                  : id === 'question' ? copy.soundStateQuestion : copy.soundStateApproval))),
              h('span', { className: 'dsh-orb-chevron', 'aria-hidden': true },
                h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, focusable: 'false' },
                  h('path', {
                    d: 'M4 6.5 L8 10.5 L12 6.5',
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.6,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  })))),
            h('button', {
              className: 'dsh-orb-action',
              type: 'button',
              onClick: choose,
              'aria-label': copy.soundTitle + '：' + copy.soundPick,
            }, copy.soundPick),
            h('button', {
              className: 'dsh-orb-action',
              type: 'button',
              onClick: () => previewSlot(slot),
              'aria-label': copy.soundTitle + '：' + copy.soundPreview,
            }, copy.soundPreview),
            entry.name === ''
              ? null
              : h('button', {
                key: 'reset',
                className: 'dsh-orb-action',
                type: 'button',
                onClick: reset,
                'aria-label': copy.soundTitle + '：' + copy.soundReset,
              }, copy.soundReset),
            h('input', {
              key: 'file',
              ref: fileRef,
              type: 'file',
              accept: 'audio/*',
              style: { display: 'none' },
              onChange: onPicked,
            }))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        hostContext = ctx
        copy = copyFor(ctx)
        ctx.on('locale/change', () => {
          copy = copyFor(ctx)
          notifyCopy()
        })
        void loadStoredSounds()
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'dsh-harness-orb-reminders',
          order: 40,
        }, ReminderRow))
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'dsh-harness-orb-sound',
          order: 41,
        }, SoundRow))
        ctx.inject(['uiSession'], (scope) => {
          scope.effect(() => {
            const source = scope.uiSession && scope.uiSession.sessionStatus
            if (!source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') {
              console.error('[dsh-harness-orb] uiSession exposes no session status source')
              return () => {}
            }
            statusSource = source
            const initial = source.getSnapshot()
            // A request already waiting when this page opened is adopted rather
            // than folded into the baseline, so closing the app mid-approval and
            // reopening it does not silence that approval for good.
            adoptPending(initial)
            let previous = initial
            const changed = () => {
              try {
                const next = source.getSnapshot()
                remind(previous, next)
                previous = next
              } catch (error) {
                console.error('[dsh-harness-orb] session status handling failed', error)
              }
            }
            const dispose = source.subscribe(changed)
            return () => {
              statusSource = undefined
              stopAllEscalations()
              if (typeof dispose === 'function') dispose()
            }
          }, 'dsh-harness-orb: session status')
        })
        ctx.effect(() => {
          const unlock = () => {
            unlockAudio()
            requestNotificationPermission()
          }
          window.addEventListener('pointerdown', unlock, true)
          window.addEventListener('keydown', unlock, true)
          return () => {
            window.removeEventListener('pointerdown', unlock, true)
            window.removeEventListener('keydown', unlock, true)
          }
        }, 'dsh-harness-orb: audio unlock')
        ctx.effect(() => () => {
          stopAllEscalations()
          stopPlaying()
          const context = audio
          audio = undefined
          if (context && typeof context.close === 'function') {
            try {
              context.close()
            } catch (_error) {
              /* A context that already ended needs no close. */
            }
          }
        }, 'dsh-harness-orb: audio lifetime')
      },
    }
  },
})

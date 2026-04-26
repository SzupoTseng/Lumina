import { useCallback, useContext, useEffect, useRef, useState } from "react";
import VrmViewer from "@/components/vrmViewer";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import {
  Message,
  textsToScreenplay,
  Screenplay,
} from "@/features/messages/messages";
import { speakCharacter } from "@/features/messages/speakCharacter";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { SYSTEM_PROMPT } from "@/features/constants/systemPromptConstants";
import { KoeiroParam, DEFAULT_KOEIRO_PARAM } from "@/features/constants/koeiroParam";
import { getChatResponseStream } from "@/features/chat/openAiChat";
import { M_PLUS_2, Montserrat } from "next/font/google";
import { Introduction } from "@/components/introduction";
import { Menu } from "@/components/menu";
import { GitHubLink } from "@/components/githubLink";
import { Meta } from "@/components/meta";
import { ElevenLabsParam, DEFAULT_ELEVEN_LABS_PARAM } from "@/features/constants/elevenLabsParam";
import { buildUrl } from "@/utils/buildUrl";
import { websocketService } from '../services/websocketService';
import { MessageMiddleOut } from "@/features/messages/messageMiddleOut";
import { connectBuddyEvents, type PersonalityOverride } from "@/features/buddyEvents/buddyEvents";
import { type Personality } from "@/components/personalitySelector";
import { SettingsPanel } from "@/components/settingsPanel";
import { StatusBar } from "@/components/statusBar";
import { StatusPanel } from "@/components/statusPanel";
import { type StatusInfo } from "@/features/buddyEvents/buddyEvents";
import { DemoPanel } from "@/components/demoPanel";
import { BuddyLogPanel, useBuddyLog } from "@/components/buddyLog";
import { useHydrateLocale, getLocale } from "@/features/i18n/i18n";
import { AchievementToast } from "@/components/achievementToast";
import {
  feedEvent as feedAchievementEvent,
  loadState as loadAchievementState,
  saveState as saveAchievementState,
  type AchievementDef,
  type AchievementState,
} from "@/features/achievements/achievements";
import { TaskListPanel } from "@/components/taskListPanel";
import {
  feedEvent as feedTaskEvent,
  loadTaskState,
  saveTaskState,
  visibleTasks,
  type TaskTrackerState,
} from "@/features/taskTracker/taskTracker";
import {
  feedEvent as feedMemoryEvent,
  loadMemory,
  saveMemory,
  pickReminiscence,
  recordAchievementMemory,
  type MemoryState,
} from "@/features/memoryStream/memoryStream";
import {
  feedEvent as feedMonitorEvent,
  emptyState as emptyMonitorState,
  type AgentMonitorState,
} from "@/features/agentMonitor/agentMonitor";
import { EnergyGathering, isLongTaskCommand } from "@/components/energyGathering";
import { TriumphMoment, CrisisGlitch } from "@/components/cinematicOverlays";
import { routeSlashCommand } from "@/features/slashRoute/slashRoute";
import {
  POWER_TUNING,
  type PowerMode,
} from "@/features/powerMode/powerMode";

const m_plus_2 = M_PLUS_2({
  variable: "--font-m-plus-2",
  display: "swap",
  preload: false,
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  display: "swap",
  subsets: ["latin"],
});

type LLMCallbackResult = {
  processed: boolean;
  error?: string;
};

export default function Home() {
  useHydrateLocale();
  const { viewer } = useContext(ViewerContext);

  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT);
  const [openAiKey, setOpenAiKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [elevenLabsParam, setElevenLabsParam] = useState<ElevenLabsParam>(DEFAULT_ELEVEN_LABS_PARAM);
  const [koeiroParam, setKoeiroParam] = useState<KoeiroParam>(DEFAULT_KOEIRO_PARAM);
  const [chatProcessing, setChatProcessing] = useState(false);
  const [chatLog, setChatLog] = useState<Message[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { entries: buddyLogEntries, append: appendBuddyLog, clear: clearBuddyLog } = useBuddyLog();

  // Intercept setAssistantMessage to also log to buddy log
  const setAssistantMessageAndLog = useCallback((msg: string) => {
    setAssistantMessage(msg);
    if (msg) appendBuddyLog(msg);
  }, [appendBuddyLog]);
  const [backgroundImage, setBackgroundImage] = useState<string>('');
  const [restreamTokens, setRestreamTokens] = useState<any>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  // needed because AI speaking could involve multiple audios being played in sequence
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [openRouterKey, setOpenRouterKey] = useState<string>(() => {
    // Try to load from localStorage on initial render
    if (typeof window !== 'undefined') {
      return localStorage.getItem('openRouterKey') || '';
    }
    return '';
  });

  useEffect(() => {
    if (window.localStorage.getItem("chatVRMParams")) {
      const params = JSON.parse(
        window.localStorage.getItem("chatVRMParams") as string
      );
      setSystemPrompt(params.systemPrompt);
      setElevenLabsParam(params.elevenLabsParam);
      setChatLog(params.chatLog);
    }
    if (window.localStorage.getItem("elevenLabsKey")) {
      const key = window.localStorage.getItem("elevenLabsKey") as string;
      setElevenLabsKey(key);
    }
    // load openrouter key from localStorage
    const savedOpenRouterKey = localStorage.getItem('openRouterKey');
    if (savedOpenRouterKey) {
      setOpenRouterKey(savedOpenRouterKey);
    }
    const savedBackground = localStorage.getItem('backgroundImage');
    if (savedBackground) {
      setBackgroundImage(savedBackground);
    }
  }, []);

  useEffect(() => {
    process.nextTick(() => {
      window.localStorage.setItem(
        "chatVRMParams",
        JSON.stringify({ systemPrompt, elevenLabsParam, chatLog })
      )

      // store separately to be backward compatible with local storage data
      window.localStorage.setItem("elevenLabsKey", elevenLabsKey);
    }
    );
  }, [systemPrompt, elevenLabsParam, chatLog]);

  useEffect(() => {
    if (backgroundImage) {
      document.body.style.backgroundImage = `url(${backgroundImage})`;
      // document.body.style.backgroundSize = 'cover';
      // document.body.style.backgroundPosition = 'center';
    } else {
      document.body.style.backgroundImage = `url(${buildUrl("/bg-c.png")})`;
    }
  }, [backgroundImage]);

  // Refs so the buddy-event gate sees the latest chat-state flags without
  // forcing the EventSource to reconnect on every chat tick.
  const chatProcessingRef = useRef(chatProcessing);
  const isAISpeakingRef = useRef(isAISpeaking);
  useEffect(() => { chatProcessingRef.current = chatProcessing; }, [chatProcessing]);
  useEffect(() => { isAISpeakingRef.current = isAISpeaking; }, [isAISpeaking]);

  // Personality ref — buddyEvents reads .current per event so live switches
  // don't tear down the SSE connection.
  const personalityRef = useRef<PersonalityOverride | null>(null);

  const handlePersonalityChange = useCallback((p: Personality | null) => {
    personalityRef.current = p
      ? { defaultEmotion: p.defaultEmotion, reactions: p.reactions }
      : null;
    if (p) {
      setSystemPrompt(p.systemPrompt);
    }
  }, []);

  // Achievement state. Held in a ref to avoid re-rendering the buddy effect
  // on every counter tick (would tear down SSE). The toast state IS React
  // state because we want to re-render on unlock.
  const achievementsRef = useRef<AchievementState | null>(null);
  if (achievementsRef.current === null && typeof window !== "undefined") {
    achievementsRef.current = loadAchievementState();
  }
  const [achievementToast, setAchievementToast] = useState<AchievementDef | null>(null);
  const dismissAchievementToast = useCallback(() => setAchievementToast(null), []);

  // Task tracker state — fed off the same event stream. We DO use React
  // state here (unlike achievements) because the panel re-renders on every
  // change. Initial load deferred to first render to avoid SSR hydration
  // mismatches.
  // SSR-safe: start with empty state to avoid hydration mismatch,
  // then load from localStorage in useEffect (client-only).
  const [taskState, setTaskState] = useState<TaskTrackerState>({ version: 1, tasks: {}, order: [] });
  useEffect(() => { setTaskState(loadTaskState()); }, []);

  // Memory stream — append-only log of significant events. Held in a ref
  // (no UI binding except the SessionStart reminiscence override below).
  const memoryRef = useRef<MemoryState | null>(null);
  if (memoryRef.current === null && typeof window !== "undefined") {
    memoryRef.current = loadMemory();
  }

  // Agent monitor — detects edit loops, edit reverts, dangerous commands.
  // In-memory only; per-session, doesn't survive reload (intentional).
  const monitorRef = useRef<AgentMonitorState>(emptyMonitorState());

  // Energy-gathering effect for long bash tasks. Auto-clears 60 s after
  // activation as a safety net in case the matching PostToolUse never
  // arrives (timeout, killed task, etc.).
  const [longTask, setLongTask] = useState<{ command: string } | null>(null);
  const longTaskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cinematic overlays. Both auto-clear themselves via CSS animation
  // duration; React state cleanup happens after the animation finishes.
  const [triumphActive, setTriumphActive] = useState<{ message?: string } | null>(null);
  const [crisisActive, setCrisisActive] = useState<{ message?: string } | null>(null);
  const triumphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crisisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Power mode — read from a ref so changing it doesn't tear down the
  // SSE effect. PowerModeSelector calls handlePowerModeChange to keep the
  // ref synced.
  const powerModeRef = useRef<PowerMode>("balanced");
  const handlePowerModeChange = useCallback((mode: PowerMode) => {
    powerModeRef.current = mode;
  }, []);

  const fireTriumph = useCallback((message?: string) => {
    const tuning = POWER_TUNING[powerModeRef.current];
    if (!tuning.overlaysEnabled) return;
    setTriumphActive({ message });
    if (triumphTimerRef.current) clearTimeout(triumphTimerRef.current);
    triumphTimerRef.current = setTimeout(
      () => setTriumphActive(null),
      tuning.triumphDurationMs,
    );
  }, []);

  const fireCrisis = useCallback((message?: string) => {
    const tuning = POWER_TUNING[powerModeRef.current];
    if (!tuning.overlaysEnabled) return;
    setCrisisActive({ message });
    if (crisisTimerRef.current) clearTimeout(crisisTimerRef.current);
    crisisTimerRef.current = setTimeout(
      () => setCrisisActive(null),
      tuning.crisisDurationMs,
    );
  }, []);

  useEffect(() => {
    if (!viewer) return;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const disconnect = connectBuddyEvents(viewer, {
      onStatusUpdate: (info) => {
        setStatusInfo(info);
        // Logging handled by onMessage via emit() in buddyEvents.ts
        // Auto-hide StatusPanel after 30s if no new update
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => setStatusInfo(null), 30_000);
      },
      onMessage: (text) => {
        // Always log — regardless of processing state (log is a record, not a display)
        if (text) appendBuddyLog(text);

        // Guard display: stay out of Claude's way while speaking or processing
        if (chatProcessingRef.current || isAISpeakingRef.current) return;
        if (clearTimer) clearTimeout(clearTimer);

        // SessionStart reminiscence override
        let resolved = text;
        if (
          memoryRef.current &&
          (text.startsWith("👋") || text.includes("Claude 來上班了"))
        ) {
          const memory = pickReminiscence(memoryRef.current);
          if (memory) resolved = memory;
        }
        setAssistantMessage(resolved);   // display only (appendBuddyLog already ran above)
        clearTimer = setTimeout(() => setAssistantMessage(""), 4000);
      },
      personalityRef,
      onAfterApply: (evt) => {
        // Slash command routing: when the user types a `/...` prompt,
        // route it through existing IP-safe overlays. UserPromptSubmit
        // hook context carries `prompt` — see Claude Code hook docs.
        if (evt.type === "UserPromptSubmit") {
          const ctx = evt.context as { prompt?: string } | undefined;
          const prompt = ctx?.prompt;
          if (typeof prompt === "string") {
            const route = routeSlashCommand(prompt);
            if (route && POWER_TUNING[powerModeRef.current].overlaysEnabled) {
              if (route.kind === "energy_gather") {
                setLongTask({ command: prompt });
                if (longTaskTimerRef.current) clearTimeout(longTaskTimerRef.current);
                longTaskTimerRef.current = setTimeout(
                  () => setLongTask(null),
                  route.durationMs,
                );
              } else if (route.kind === "triumph") {
                setTriumphActive({ message: route.line });
                if (triumphTimerRef.current) clearTimeout(triumphTimerRef.current);
                triumphTimerRef.current = setTimeout(
                  () => setTriumphActive(null),
                  route.durationMs,
                );
              } else if (route.kind === "flash" || route.kind === "crisis") {
                // Both reuse the CrisisGlitch component; only difference
                // is duration (flash ~1.2 s for cleanup vibes, crisis
                // ~3.2 s for alarming vibes).
                setCrisisActive({ message: route.line });
                if (crisisTimerRef.current) clearTimeout(crisisTimerRef.current);
                crisisTimerRef.current = setTimeout(
                  () => setCrisisActive(null),
                  route.durationMs,
                );
              }
            }
          }
        }

        // Feed the same event into the achievement counters. Pure-function
        // call; we round-trip state through the ref + localStorage rather
        // than React state to keep the SSE connection lifecycle stable.
        if (achievementsRef.current) {
          const result = feedAchievementEvent(achievementsRef.current, evt);
          achievementsRef.current = result.state;
          if (result.unlocked.length > 0) {
            saveAchievementState(result.state);
            setAchievementToast(result.unlocked[0]);
            // Also push achievement unlocks into the memory stream so the
            // next session can reminisce about them.
            if (memoryRef.current) {
              for (const a of result.unlocked) {
                memoryRef.current = recordAchievementMemory(
                  memoryRef.current,
                  a.name(),
                );
              }
              saveMemory(memoryRef.current);
            }
          } else {
            const totalTicks = Object.values(result.state.counters).reduce(
              (a, b) => a + b,
              0,
            );
            if (totalTicks % 10 === 0) {
              saveAchievementState(result.state);
            }
          }
        }

        // Feed the same event into the task tracker. We DO use React
        // setState here because the panel must re-render on each task
        // create/update.
        setTaskState((current) => {
          const result = feedTaskEvent(current, evt);
          if (result.changed) saveTaskState(result.state);
          return result.changed ? result.state : current;
        });

        // Feed the same event into the memory stream.
        if (memoryRef.current) {
          const result = feedMemoryEvent(memoryRef.current, evt);
          if (result.changed) {
            memoryRef.current = result.state;
            saveMemory(result.state);
          }
        }

        // Long-task energy gathering: PreToolUse Bash with a long-task
        // command starts the effect; PostToolUse for the same command
        // clears it. 60 s safety timeout cleans up if PostToolUse never
        // arrives.
        if (evt.tool === "Bash") {
          const ctx = evt.context as
            | { tool_input?: { command?: string }; tool_response?: { output?: string; error?: string; isError?: boolean } }
            | undefined;
          const cmd = ctx?.tool_input?.command;
          if (typeof cmd === "string" && isLongTaskCommand(cmd)) {
            if (evt.type === "PreToolUse") {
              if (POWER_TUNING[powerModeRef.current].overlaysEnabled) {
                setLongTask({ command: cmd });
                if (longTaskTimerRef.current) clearTimeout(longTaskTimerRef.current);
                longTaskTimerRef.current = setTimeout(() => {
                  setLongTask(null);
                  longTaskTimerRef.current = null;
                }, 60_000);
              }
            } else if (evt.type === "PostToolUse") {
              setLongTask(null);
              if (longTaskTimerRef.current) {
                clearTimeout(longTaskTimerRef.current);
                longTaskTimerRef.current = null;
              }
            }
          }

          // Triumph moment on big clean test pass. Re-runs the same
          // detector buddyEvents uses internally so we can read the
          // passed-count and gate on a meaningful suite size.
          if (evt.type === "PostToolUse" && typeof cmd === "string") {
            const out = String(ctx?.tool_response?.output ?? "") + String(ctx?.tool_response?.error ?? "");
            const m = out.match(
              /=+\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+errors?)?\s+in\s+([\d.]+)s/i,
            );
            if (m) {
              const passed = Number(m[1]);
              const failed = m[2] ? Number(m[2]) : 0;
              const errors = m[3] ? Number(m[3]) : 0;
              if (passed >= 10 && failed === 0 && errors === 0) {
                fireTriumph(getLocale()==='en' ? `🎯 ${passed} tests passed. All according to plan.` : getLocale()==='ja' ? `🎯 ${passed}個テスト通過。計画通り。` : `🎯 ${passed} 個測試全過。一切都在計畫之中。`);
              }
            }
          }
        }

        // Feed the same event into the agent monitor. If a misbehavior
        // alert fires, override the bubble + emote with the warning.
        // Skip while Claude is mid-response to avoid clobbering speech.
        const monitorResult = feedMonitorEvent(monitorRef.current, evt);
        monitorRef.current = monitorResult.state;
        const alert = monitorResult.alert;
        if (alert && !chatProcessingRef.current && !isAISpeakingRef.current) {
          if (clearTimer) clearTimeout(clearTimer);
          setAssistantMessageAndLog(alert.line);
          clearTimer = setTimeout(() => setAssistantMessage(""), 5000);
          try {
            viewer.model?.emoteController?.playEmotion(alert.emotion);
          } catch {
            // ignore — model may not be loaded
          }
          // Crisis glitch overlay on the most severe alerts only — same
          // signal that already shows the 🛑 line in the bubble.
          if (alert.severity === "stop") {
            fireCrisis(`💥 ${alert.line}`);
          }
          // Record into memory as a negative entry so weekly digests can
          // mention "this week we got stuck N times".
          if (memoryRef.current) {
            memoryRef.current = {
              version: memoryRef.current.version,
              entries: memoryRef.current.entries.concat({
                ts: alert.ts,
                kind: `monitor_${alert.kind}`,
                summary:
                  alert.kind === "edit_loop"
                    ? "在某個檔案繞圈圈"
                    : alert.kind === "edit_revert"
                    ? "撤掉了自己上一個改動"
                    : `跑了危險指令 (${alert.command ?? ""})`,
                sentiment: "negative",
              }),
            };
            saveMemory(memoryRef.current);
          }
        }
      },
    });
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      disconnect();
    };
  }, [viewer]);

  const handleChangeChatLog = useCallback(
    (targetIndex: number, text: string) => {
      const newChatLog = chatLog.map((v: Message, i) => {
        return i === targetIndex ? { role: v.role, content: text } : v;
      });

      setChatLog(newChatLog);
    },
    [chatLog]
  );

  /**
   * 文ごとに音声を直接でリクエストしながら再生する
   */
  const handleSpeakAi = useCallback(
    async (
      screenplay: Screenplay,
      elevenLabsKey: string,
      elevenLabsParam: ElevenLabsParam,
      onStart?: () => void,
      onEnd?: () => void
    ) => {
      setIsAISpeaking(true);  // Set speaking state before starting
      try {
        await speakCharacter(
          screenplay, 
          elevenLabsKey, 
          elevenLabsParam, 
          viewer, 
          () => {
            setIsPlayingAudio(true);
            console.log('audio playback started');
            onStart?.();
          }, 
          () => {
            setIsPlayingAudio(false);
            console.log('audio playback completed');
            onEnd?.();
          }
        );
      } catch (error) {
        console.error('Error during AI speech:', error);
      } finally {
        setIsAISpeaking(false);  // Ensure speaking state is reset even if there's an error
      }
    },
    [viewer]
  );

  /**
   * アシスタントとの会話を行う
   */
  const handleSendChat = useCallback(
    async (text: string) => {
      const newMessage = text;
      if (newMessage == null) return;

      setChatProcessing(true);
      // Add user's message to chat log
      const messageLog: Message[] = [
        ...chatLog,
        { role: "user", content: newMessage },
      ];
      setChatLog(messageLog);

      // Process messages through MessageMiddleOut
      const messageProcessor = new MessageMiddleOut();
      const processedMessages = messageProcessor.process([
        {
          role: "system",
          content: systemPrompt,
        },
        ...messageLog,
      ]);

      let localOpenRouterKey = openRouterKey;
      if (!localOpenRouterKey) {
        // fallback to free key for users to try things out
        localOpenRouterKey = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY!;
      }

      const stream = await getChatResponseStream(processedMessages, openAiKey, localOpenRouterKey).catch(
        (e) => {
          console.error(e);
          return null;
        }
      );
      if (stream == null) {
        setChatProcessing(false);
        return;
      }

      const reader = stream.getReader();
      let receivedMessage = "";
      let aiTextLog = "";
      let tag = "";
      const sentences = new Array<string>();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          receivedMessage += value;

          // console.log('receivedMessage');
          // console.log(receivedMessage);

          // 返答内容のタグ部分の検出
          const tagMatch = receivedMessage.match(/^\[(.*?)\]/);
          if (tagMatch && tagMatch[0]) {
            tag = tagMatch[0];
            receivedMessage = receivedMessage.slice(tag.length);

            console.log('tag:');
            console.log(tag);
          }

          // 返答を一単位で切り出して処理する
          const sentenceMatch = receivedMessage.match(
            /^(.+[。．！？\n.!?]|.{10,}[、,])/
          );
          if (sentenceMatch && sentenceMatch[0]) {
            const sentence = sentenceMatch[0];
            sentences.push(sentence);

            console.log('sentence:');
            console.log(sentence);

            receivedMessage = receivedMessage
              .slice(sentence.length)
              .trimStart();

            // 発話不要/不可能な文字列だった場合はスキップ
            if (
              !sentence.replace(
                /^[\s\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]]+$/g,
                ""
              )
            ) {
              continue;
            }

            const aiText = `${tag} ${sentence}`;
            const aiTalks = textsToScreenplay([aiText], koeiroParam);
            aiTextLog += aiText;

            // 文ごとに音声を生成 & 再生、返答を表示
            const currentAssistantMessage = sentences.join(" ");
            handleSpeakAi(aiTalks[0], elevenLabsKey, elevenLabsParam, () => {
              setAssistantMessageAndLog(currentAssistantMessage);
            });
          }
        }
      } catch (e) {
        setChatProcessing(false);
        console.error(e);
      } finally {
        reader.releaseLock();
      }

      // アシスタントの返答をログに追加
      const messageLogAssistant: Message[] = [
        ...messageLog,
        { role: "assistant", content: aiTextLog },
      ];

      setChatLog(messageLogAssistant);
      setChatProcessing(false);
    },
    [systemPrompt, chatLog, handleSpeakAi, openAiKey, elevenLabsKey, elevenLabsParam, openRouterKey]
  );

  const handleTokensUpdate = useCallback((tokens: any) => {
    setRestreamTokens(tokens);
  }, []);

  // Set up global websocket handler
  useEffect(() => {
    websocketService.setLLMCallback(async (message: string): Promise<LLMCallbackResult> => {
      try {
        if (isAISpeaking || isPlayingAudio || chatProcessing) {
          console.log('Skipping message processing - system busy');
          return {
            processed: false,
            error: 'System is busy processing previous message'
          };
        }
        
        await handleSendChat(message);
        return {
          processed: true
        };
      } catch (error) {
        console.error('Error processing message:', error);
        return {
          processed: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
      }
    });
  }, [handleSendChat, chatProcessing, isPlayingAudio, isAISpeaking]);

  const handleOpenRouterKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newKey = event.target.value;
    setOpenRouterKey(newKey);
    localStorage.setItem('openRouterKey', newKey);
  };

  return (
    <div className={`${m_plus_2.variable} ${montserrat.variable}`}>
      <Meta />
      <Introduction
        openAiKey={openAiKey}
        onChangeAiKey={setOpenAiKey}
        elevenLabsKey={elevenLabsKey}
        onChangeElevenLabsKey={setElevenLabsKey}
      />
      <VrmViewer />
      <StatusBar />
      <StatusPanel info={statusInfo} />
      <DemoPanel
        onMessage={setAssistantMessageAndLog}
        onEmotion={(e) => viewer.model?.emoteController?.playEmotion(e)}
        onEffect={(kind, msg, dur) => {
          if (!POWER_TUNING[powerModeRef.current].overlaysEnabled) return;
          if (kind === "energy_gather") {
            setLongTask({ command: msg });
            setTimeout(() => setLongTask(null), dur);
          } else if (kind === "triumph") {
            setTriumphActive({ message: msg });
            setTimeout(() => setTriumphActive(null), dur);
          } else {
            setCrisisActive({ message: msg });
            setTimeout(() => setCrisisActive(null), dur);
          }
        }}
      />
      <SettingsPanel
        onPersonalityChange={handlePersonalityChange}
        onPowerModeChange={handlePowerModeChange}
        buddyLogEntries={buddyLogEntries}
        onClearBuddyLog={clearBuddyLog}
      />
      <AchievementToast
        achievement={achievementToast}
        onDismiss={dismissAchievementToast}
      />
      <TaskListPanel
        tasks={visibleTasks(taskState, { hideCompleted: false })}
      />
      <EnergyGathering
        active={!!longTask}
        message="🌐 集中精神…"
        particleCount={POWER_TUNING[powerModeRef.current].energyParticleCount}
      />
      <TriumphMoment
        active={!!triumphActive}
        message={triumphActive?.message}
      />
      <CrisisGlitch
        active={!!crisisActive}
        message={crisisActive?.message}
      />
      <MessageInputContainer
        isChatProcessing={chatProcessing}
        onChatProcessStart={handleSendChat}
      />
      <Menu
        openAiKey={openAiKey}
        elevenLabsKey={elevenLabsKey}
        openRouterKey={openRouterKey}
        systemPrompt={systemPrompt}
        chatLog={chatLog}
        elevenLabsParam={elevenLabsParam}
        koeiroParam={koeiroParam}
        assistantMessage={assistantMessage}
        onChangeAiKey={setOpenAiKey}
        onChangeElevenLabsKey={setElevenLabsKey}
        onChangeSystemPrompt={setSystemPrompt}
        onChangeChatLog={handleChangeChatLog}
        onChangeElevenLabsParam={setElevenLabsParam}
        onChangeKoeiromapParam={setKoeiroParam}
        handleClickResetChatLog={() => setChatLog([])}
        handleClickResetSystemPrompt={() => setSystemPrompt(SYSTEM_PROMPT)}
        backgroundImage={backgroundImage}
        onChangeBackgroundImage={setBackgroundImage}
        onTokensUpdate={handleTokensUpdate}
        onChatMessage={handleSendChat}
        onChangeOpenRouterKey={handleOpenRouterKeyChange}
        buddyLogEntries={buddyLogEntries}
        onClearBuddyLog={clearBuddyLog}
      />
      <GitHubLink />
    </div>
  );
}

import { IconButton } from "./iconButton";
import { Message } from "@/features/messages/messages";
import { ElevenLabsParam } from "@/features/constants/elevenLabsParam";
import { KoeiroParam } from "@/features/constants/koeiroParam";
import { ChatLog } from "./chatLog";
import React, { useCallback, useContext, useRef, useState, useEffect } from "react";
import { Settings } from "./settings";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { AssistantText } from "./assistantText";

// File System Access API type (not yet in all TS lib versions)
declare global {
  interface Window {
    showOpenFilePicker(opts?: {
      types?: { description?: string; accept: Record<string, string[]> }[];
      excludeAcceptAllOption?: boolean;
      startIn?: FileSystemDirectoryHandle | string;
      multiple?: boolean;
    }): Promise<FileSystemFileHandle[]>;
  }
  interface FileSystemFileHandle {
    getFile(): Promise<File>;
  }
}

// Minimal IndexedDB helpers for storing FileSystemDirectoryHandle across sessions
function openIDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open("lumina", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function idbGet(db: IDBDatabase, key: string): Promise<any> {
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function idbSet(db: IDBDatabase, key: string, val: any): Promise<void> {
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

type Props = {
  openAiKey: string;
  elevenLabsKey: string;
  systemPrompt: string;
  chatLog: Message[];
  elevenLabsParam: ElevenLabsParam;
  koeiroParam: KoeiroParam;
  assistantMessage: string;
  onChangeSystemPrompt: (systemPrompt: string) => void;
  onChangeAiKey: (key: string) => void;
  onChangeElevenLabsKey: (key: string) => void;
  onChangeChatLog: (index: number, text: string) => void;
  onChangeElevenLabsParam: (param: ElevenLabsParam) => void;
  onChangeKoeiromapParam: (param: KoeiroParam) => void;
  handleClickResetChatLog: () => void;
  handleClickResetSystemPrompt: () => void;
  backgroundImage: string;
  onChangeBackgroundImage: (value: string) => void;
  onChatMessage: (message: string) => void;
  onTokensUpdate: (tokens: any) => void;
  onChangeOpenRouterKey: (event: React.ChangeEvent<HTMLInputElement>) => void;
  openRouterKey: string;
  buddyLogEntries?: import("@/components/buddyLog").BuddyLogEntry[];
  onClearBuddyLog?: () => void;
};
export const Menu = ({
  openAiKey,
  elevenLabsKey,
  openRouterKey,
  systemPrompt,
  chatLog,
  elevenLabsParam,
  koeiroParam,
  assistantMessage,
  onChangeSystemPrompt,
  onChangeAiKey,
  onChangeElevenLabsKey,
  onChangeChatLog,
  onChangeElevenLabsParam,
  onChangeKoeiromapParam,
  handleClickResetChatLog,
  handleClickResetSystemPrompt,
  backgroundImage,
  onChangeBackgroundImage,
  onChatMessage,
  onTokensUpdate,
  onChangeOpenRouterKey,
  buddyLogEntries = [],
  onClearBuddyLog,
}: Props) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showChatLog, setShowChatLog] = useState(false);
  const [showBuddyLog, setShowBuddyLog] = useState(false);
  const { viewer } = useContext(ViewerContext);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedBackground = localStorage.getItem('backgroundImage');
    if (savedBackground) {
      onChangeBackgroundImage(savedBackground);
    }
  }, [onChangeBackgroundImage]);

  const handleChangeSystemPrompt = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChangeSystemPrompt(event.target.value);
    },
    [onChangeSystemPrompt]
  );

  const handleAiKeyChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChangeAiKey(event.target.value);
    },
    [onChangeAiKey]
  );

  const handleElevenLabsKeyChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChangeElevenLabsKey(event.target.value);
    },
    [onChangeElevenLabsKey]
  );

  const handleElevenLabsVoiceChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      onChangeElevenLabsParam({
        voiceId: event.target.value
      });
    },
    [onChangeElevenLabsParam]
  );

  const handleChangeKoeiroParam = useCallback(
    (x: number, y: number) => {
      onChangeKoeiromapParam({
        speakerX: x,
        speakerY: y,
      });
    },
    [onChangeKoeiromapParam]
  );

  // VRM dir handle is persisted in IndexedDB so the file picker remembers
  // the public/ folder after the first pick.
  const VRM_DIR_KEY = "lumina.vrmDirHandle";

  const handleClickOpenVrmFile = useCallback(async () => {
    // Use File System Access API (showOpenFilePicker) if available — lets us
    // set startIn to a remembered directory handle (defaults to public/).
    if (typeof window.showOpenFilePicker === "function") {
      try {
        // Try to retrieve previously stored directory handle
        let startIn: FileSystemDirectoryHandle | undefined;
        try {
          const db = await openIDB();
          startIn = await idbGet(db, VRM_DIR_KEY);
        } catch { /* ignore — fall back to default */ }

        const [fh] = await window.showOpenFilePicker({
          types: [{ description: "VRM Model", accept: { "application/octet-stream": [".vrm"] } }],
          excludeAcceptAllOption: true,
          ...(startIn ? { startIn } : {}),
        });

        // Remember the parent directory for next time
        try {
          const dir = await (fh as any).getParent?.();
          if (dir) {
            const db = await openIDB();
            await idbSet(db, VRM_DIR_KEY, dir);
          }
        } catch { /* getParent not always available */ }

        const file = await fh.getFile();
        const blob = new Blob([await file.arrayBuffer()], { type: "application/octet-stream" });
        viewer.loadVrm(window.URL.createObjectURL(blob));
        return;
      } catch (e: any) {
        if (e.name === "AbortError") return; // user cancelled
        // fall through to legacy input
      }
    }
    fileInputRef.current?.click();
  }, [viewer]);

  const handleChangeVrmFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const file = files[0];
      if (!file) return;

      const file_type = file.name.split(".").pop();

      if (file_type === "vrm") {
        const blob = new Blob([file], { type: "application/octet-stream" });
        const url = window.URL.createObjectURL(blob);
        viewer.loadVrm(url);
      }

      event.target.value = "";
    },
    [viewer]
  );

  const handleBackgroundImageChange = (image: string) => {
    onChangeBackgroundImage(image);
  };

  return (
    <>
      <div className="absolute z-10 m-24">
        <div className="grid grid-flow-col gap-[8px]">
          <IconButton
            iconName="24/Menu"
            label="Settings"
            isProcessing={false}
            onClick={() => setShowSettings(true)}
          ></IconButton>
          {showChatLog ? (
            <IconButton
              iconName="24/CommentOutline"
              label="Conversation Log"
              isProcessing={false}
              onClick={() => setShowChatLog(false)}
            />
          ) : (
            <IconButton
              iconName="24/CommentFill"
              label="Conversation Log"
              isProcessing={false}
              disabled={chatLog.length <= 0}
              onClick={() => setShowChatLog(true)}
            />
          )}
          <IconButton
            iconName={showBuddyLog ? "24/CommentOutline" : "24/CommentFill"}
            label={`Buddy Log${buddyLogEntries.length > 0 ? ` (${buddyLogEntries.length})` : ""}`}
            isProcessing={false}
            onClick={() => setShowBuddyLog(b => !b)}
          />
        </div>
      </div>
      {showChatLog && <ChatLog messages={chatLog} />}
      {showBuddyLog && (
        <div className="absolute z-10 m-24 mt-[72px] w-[320px] max-h-[60vh] overflow-y-auto bg-surface1 rounded-16 p-16 flex flex-col gap-8">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold">Buddy Log</span>
            <button
              onClick={() => { onClearBuddyLog?.(); }}
              className="text-xs px-8 py-4 bg-surface3 hover:bg-surface3-hover rounded-8 text-text-primary"
            >
              清除
            </button>
          </div>
          <div className="flex flex-col gap-4">
            {buddyLogEntries.length === 0
              ? <p className="text-xs text-text-primary opacity-50 text-center py-8">尚無紀錄</p>
              : buddyLogEntries.map((e, i) => (
                <div key={i} className="text-xs border-b border-surface3 pb-4">
                  <span className="opacity-40 mr-4">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  {e.text}
                </div>
              ))
            }
          </div>
        </div>
      )}
      {showSettings && (
        <Settings
          openAiKey={openAiKey}
          elevenLabsKey={elevenLabsKey}
          openRouterKey={openRouterKey}
          elevenLabsParam={elevenLabsParam}
          chatLog={chatLog}
          systemPrompt={systemPrompt}
          koeiroParam={koeiroParam}
          onClickClose={() => setShowSettings(false)}
          onChangeAiKey={handleAiKeyChange}
          onChangeElevenLabsKey={handleElevenLabsKeyChange}
          onChangeElevenLabsVoice={handleElevenLabsVoiceChange}
          onChangeSystemPrompt={handleChangeSystemPrompt}
          onChangeChatLog={onChangeChatLog}
          onChangeKoeiroParam={handleChangeKoeiroParam}
          onClickOpenVrmFile={handleClickOpenVrmFile}
          onClickResetChatLog={handleClickResetChatLog}
          onClickResetSystemPrompt={handleClickResetSystemPrompt}
          backgroundImage={backgroundImage}
          onChangeBackgroundImage={handleBackgroundImageChange}
          onTokensUpdate={onTokensUpdate}
          onChatMessage={onChatMessage}
          onChangeOpenRouterKey={onChangeOpenRouterKey}
        />
      )}
      {!showChatLog && assistantMessage && (
        <AssistantText message={assistantMessage} />
      )}
      <input
        type="file"
        className="hidden"
        accept=".vrm"
        ref={fileInputRef}
        onChange={handleChangeVrmFile}
      />
    </>
  );
};

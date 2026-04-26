using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace LuminaLauncher;

static class ConPtyNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CreatePipe(out SafeFileHandle hR, out SafeFileHandle hW, IntPtr pAttr, int sz);

    [DllImport("kernel32.dll")]
    public static extern int CreatePseudoConsole(COORD size, SafeFileHandle hIn, SafeFileHandle hOut, uint flags, out IntPtr phPC);

    [DllImport("kernel32.dll")]
    public static extern int ResizePseudoConsole(IntPtr hPC, COORD size);

    [DllImport("kernel32.dll")]
    public static extern void ClosePseudoConsole(IntPtr hPC);

    [DllImport("kernel32.dll")]
    public static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);

    [DllImport("kernel32.dll")]
    public static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr val, IntPtr cbSize, IntPtr prev, IntPtr ret);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcess(string? app, string? cmd, IntPtr pPA, IntPtr tPA, bool inherit,
        uint flags, IntPtr env, string? dir, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr h);

    public const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    public const uint CREATE_NO_WINDOW = 0x08000000;
    public static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;
}

sealed class PseudoConsole : IDisposable
{
    private IntPtr _hPC;
    private readonly SafeFileHandle _inputRead, _inputWrite, _outputRead, _outputWrite;
    private IntPtr _hProcess;

    public Stream StdinStream { get; }
    public Stream StdoutStream { get; }

    public PseudoConsole(string command, short cols = 220, short rows = 50)
    {
        ConPtyNative.CreatePipe(out _inputRead, out _inputWrite, IntPtr.Zero, 0);
        ConPtyNative.CreatePipe(out _outputRead, out _outputWrite, IntPtr.Zero, 0);

        ConPtyNative.CreatePseudoConsole(
            new ConPtyNative.COORD { X = cols, Y = rows },
            _inputRead, _outputWrite, 0, out _hPC);

        // Close the pipe ends that were handed to ConPTY — the PTY owns them now.
        // Keeping them open in the parent blocks reads from _outputRead.
        _inputRead.Close();
        _outputWrite.Close();

        IntPtr attrSize = IntPtr.Zero;
        ConPtyNative.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
        var attrList = Marshal.AllocHGlobal(attrSize);
        try
        {
            ConPtyNative.InitializeProcThreadAttributeList(attrList, 1, 0, ref attrSize);
            var hPCBuf = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(hPCBuf, _hPC);
            ConPtyNative.UpdateProcThreadAttribute(attrList, 0,
                ConPtyNative.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                hPCBuf, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero);
            Marshal.FreeHGlobal(hPCBuf);

            var si = new ConPtyNative.STARTUPINFOEX { lpAttributeList = attrList };
            si.StartupInfo.cb = Marshal.SizeOf<ConPtyNative.STARTUPINFOEX>();

            bool ok = ConPtyNative.CreateProcess(null, command, IntPtr.Zero, IntPtr.Zero, false,
                ConPtyNative.EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero, null, ref si, out var pi);
            if (!ok)
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), $"CreateProcess failed for: {command}");

            _hProcess = pi.hProcess;
        }
        finally { Marshal.FreeHGlobal(attrList); }

        StdinStream = new FileStream(_inputWrite, FileAccess.Write, 4096, isAsync: false);
        StdoutStream = new FileStream(_outputRead, FileAccess.Read, 4096, isAsync: false);
    }

    public void Resize(short cols, short rows) =>
        ConPtyNative.ResizePseudoConsole(_hPC, new ConPtyNative.COORD { X = cols, Y = rows });

    public void Dispose()
    {
        try { ConPtyNative.ClosePseudoConsole(_hPC); } catch { }
        try { ConPtyNative.CloseHandle(_hProcess); } catch { }
        _inputRead.Dispose(); _inputWrite.Dispose();
        _outputRead.Dispose(); _outputWrite.Dispose();
    }
}

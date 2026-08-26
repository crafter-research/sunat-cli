const ALLOWED_NAMES = new Set([
	"CI",
	"COLORTERM",
	"DBUS_SESSION_BUS_ADDRESS",
	"DISPLAY",
	"FORCE_COLOR",
	"HOME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"LOGNAME",
	"NO_COLOR",
	"PATH",
	"Path",
	"PATHEXT",
	"SHELL",
	"SSH_AUTH_SOCK",
	"TERM",
	"TMPDIR",
	"TEMP",
	"TMP",
	"USER",
	"USERPROFILE",
	"APPDATA",
	"ComSpec",
	"LOCALAPPDATA",
	"SystemRoot",
	"windir",
	"WAYLAND_DISPLAY",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_RUNTIME_DIR",
]);

export function privateChildEnv(
	env: NodeJS.ProcessEnv = process.env,
	extraNames: readonly string[] = [],
	extraPrefixes: readonly string[] = [],
): NodeJS.ProcessEnv {
	const names = new Set([...ALLOWED_NAMES, ...extraNames]);
	return Object.fromEntries(
		Object.entries(env).filter(([name]) => names.has(name) || extraPrefixes.some((prefix) => name.startsWith(prefix))),
	);
}

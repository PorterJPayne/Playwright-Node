{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.fontconfig
    pkgs.freetype
    pkgs.cairo
    pkgs.pango
    pkgs.expat
    pkgs.alsa-lib
    pkgs.libxkbcommon
    pkgs.libdrm
    pkgs.dbus
    pkgs.cups
    pkgs.atk
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}

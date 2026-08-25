#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef REAL_PATH
#error REAL_PATH must be defined
#endif

static void prepend_ld_library_path(const char *dir) {
  const char *old = getenv("LD_LIBRARY_PATH");
  char buf[4096];
  if (old && old[0]) {
    snprintf(buf, sizeof buf, "%s:%s", dir, old);
  } else {
    snprintf(buf, sizeof buf, "%s", dir);
  }
  setenv("LD_LIBRARY_PATH", buf, 1);
}

int main(int argc, char **argv) {
  const char *appdir = NULL;
  char *next[argc + 1];
  int n = 0;
  int i = 0;

  for (i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--appdir") == 0 && i + 1 < argc) {
      appdir = argv[i + 1];
    } else if (strncmp(argv[i], "--appdir=", 9) == 0) {
      appdir = argv[i] + 9;
    }
  }
  if (appdir && appdir[0]) {
    prepend_ld_library_path(appdir);
  }
  next[n++] = (char *)REAL_PATH;
  for (i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--appimage-extract-and-run") == 0) {
      continue;
    }
    next[n++] = argv[i];
  }
  next[n] = NULL;
  setenv("APPIMAGE_EXTRACT_AND_RUN", "1", 1);
  execv(REAL_PATH, next);
  return 127;
}

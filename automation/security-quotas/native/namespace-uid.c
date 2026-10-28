/* Test environment has only UID 0 mapped. Present its existing vscode entry
   to PostgreSQL's OS-user checks; no real uid or filesystem privilege changes.
   Local disposable DB only, loopback listener and synthetic credentials only. */
#include <sys/types.h>
uid_t getuid(void) { return 1000; }
uid_t geteuid(void) { return 1000; }
#include <sys/stat.h>
#include <dlfcn.h>
int __xstat(int v,const char *p,struct stat *s) { int (*f)(int,const char*,struct stat*)=dlsym(RTLD_NEXT,"__xstat"); int r=f(v,p,s); if(!r && s->st_uid==0)s->st_uid=1000; return r; }
int __lxstat(int v,const char *p,struct stat *s) { int (*f)(int,const char*,struct stat*)=dlsym(RTLD_NEXT,"__lxstat"); int r=f(v,p,s); if(!r && s->st_uid==0)s->st_uid=1000; return r; }
int __fxstat(int v,int fd,struct stat *s) { int (*f)(int,int,struct stat*)=dlsym(RTLD_NEXT,"__fxstat"); int r=f(v,fd,s); if(!r && s->st_uid==0)s->st_uid=1000; return r; }

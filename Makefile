# This Makefile is only present for testing purposes.

$(info Using MACHINE=$(MACHINE))
$(info Using EXTRAS=$(EXTRAS))

BUILDDIR:=linux/clang/x86_64_fuzz_asan

print-%  : ; @echo $($*)


# optiplex-trap

Synthetic, built from recorded row `1816901372840238`: a Dell OptiPlex 3090 office PC with no
graphics card, mentioning an OptiPlex 3080 too. "OptiPlex 3080/3090" are removed before GPU
matching (`fb-scrap-engine/docs/design/PARTS_INTELLIGENCE.md:244`), so no RTX 3080 or 3090 is
read and the GPU is `not_stated`. The `cpuOrPcTitle` pattern still reads "OptiPlex" as a PC.

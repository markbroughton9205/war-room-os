# WRIM Nebula PyTorch environment + Stage 0

Status: **READY** / **STAGE0_VERIFIED**  
Next authorized pass: `READY_FOR_STAGE1_AUTHORIZATION` (not started)

Dedicated venv: `%LOCALAPPDATA%\War Room OS\venvs\wrim-pytorch\`  
Wheel: official stable `torch==2.13.0+cu130` (Windows cp313). Driver CUDA UMD 13.4. RTX 5060 Ti `sm_120` is in `torch.cuda.get_arch_list()`. No CUDA Toolkit. No nightly.

Stage 0 loaded WRIM-0 `model.*` only (164 tensors, 330 `opt.*` ignored), reference attention (not SDPA), tied embeddings, CPU then CUDA FP32 with TF32 off. Parent checkpoint was not modified. No backward. No optimizer.

Do not start Stage 1 until Commander authorizes it.

# 8.5 SIMD 기초

::: lead
[8.3](#/codegen)은 컴파일러가 루프를 벡터 명령으로 다시 쓴다는 사실과 그 보고서(`-fopt-info-vec`)를 읽는 법을 다뤘고, [8.4](#/data-oriented)는 데이터를 연속 배열로 눕히는 이유를 실측했다. 이 절은 그 두 갈래가 만나는 지점이다 — 벡터 명령이 실제로 무엇이고, 레지스터 하나에 double 몇 개가 들어가고, 자동 벡터화가 이 환경에서 몇 배를 주며(스포일러: L1에서는 5.4배, RAM이 병목이면 1.0배), 무엇이 벡터화를 막고 어떻게 뚫는지를 전부 어셈블리와 시간으로 실측한다. 포인트클라우드 변환, 관절 상태 일괄 갱신, 신호 필터링 — 로봇 워크로드의 뼈대는 "같은 연산을 수천~수십만 개 데이터에 반복"이고, CPU에는 정확히 그걸 위한 전용 명령이 이미 들어 있다.
:::

## 스칼라 명령은 레지스터의 일부만 쓴다

[8.3](#/codegen)의 어셈블리 발췌마다 나온 `addsd`는 double **하나**를 더하는 명령이다. 접미사가 답을 미리 말해 준다 — `sd`는 scalar double, 즉 "레지스터에 값 하나만 놓고 연산한다"는 뜻이다. 그런데 그 명령이 쓰는 `xmm` 레지스터는 128비트다. double은 64비트이므로, 스칼라 덧셈은 매번 레지스터의 절반을 비워 둔 채 돈다. 그 빈자리를 채우는 게 **SIMD(Single Instruction, Multiple Data)** — 한 명령이 레지스터에 나란히 실린 여러 값에 같은 연산을 동시에 적용하는 실행 방식이다.

x86-64의 SIMD는 레지스터 폭의 역사다. SSE 계열은 128비트 `xmm`(double 2개, float 4개), AVX/AVX2는 256비트 `ymm`(double 4개, float 8개), AVX-512는 512비트 `zmm`(double 8개, float 16개)을 쓴다.

```text nolines
        <---------------- 512 bit ---------------->
zmm0    [ d7 | d6 | d5 | d4 | d3 | d2 | d1 | d0 ]    AVX-512: 8 x double
ymm0                        [ d3 | d2 | d1 | d0 ]    AVX/AVX2: 4 x double
xmm0                                  [ d1 | d0 ]    SSE2:     2 x double
```

`ymm0`의 하위 128비트가 곧 `xmm0`이고, `zmm0`의 하위 256비트가 `ymm0`이다 — 같은 레지스터를 폭만 달리해 부르는 이름이다. 당신의 CPU가 어디까지 지원하는지는 `/proc/cpuinfo`의 플래그로 확인한다.

```console
$ grep -o 'sse[^ ]*\|avx[^ ]*\|fma' /proc/cpuinfo | sort -u | tr '\n' ' '
avx avx2 avx512_vnni avx512bw avx512cd avx512dq avx512f avx512vl fma sse sse2 sse3 sse4_1 sse4_2
```

(이 절의 실측 환경. SSE 전체 + AVX/AVX2 + FMA + AVX-512 주요 확장까지 지원한다.) 컴파일러가 이 중 무엇을 실제로 쓰기로 했는지는 컴파일러 자신에게 묻는 게 정확하다 — `-march=native`는 "지금 이 빌드 머신의 CPU가 가진 모든 확장을 써도 된다"는 허가다.

```console
$ gcc -march=native -Q --help=target | grep -E "\-m(sse4.2|avx|avx2|avx512f|fma) "
  -mavx                       		[enabled]
  -mavx2                      		[enabled]
  -mavx512f                   		[enabled]
  -mfma                       		[enabled]
  -msse4.2                    		[enabled]
```

기억할 사실 하나: 이 허가가 없으면 g++은 x86-64 기준선인 SSE2(128비트)까지만 쓴다. [8.3](#/codegen)의 벡터화 보고가 전부 "16 byte vectors"였던 이유가 그것이다 — `-march` 계열 플래그 없이는 2006년 이후 CPU가 가진 나머지 폭이 전부 잠들어 있다.

::: hist MMX에서 AVX-512까지
x86 SIMD는 1997년 MMX(64비트, 정수 전용)로 시작해 SSE(1999, 128비트 float), SSE2(2001, double과 정수 — x86-64의 기준선이 된 이유), AVX(2011, 256비트), AVX2(2013, 256비트 정수 완성 + FMA와 동세대), AVX-512(2016~, 512비트 + 마스크 레지스터)로 폭을 두 배씩 늘려 왔다. 이름이 난립하는 것처럼 보이지만 축은 하나다 — "한 명령이 몇 바이트를 처리하는가". ARM 쪽에는 NEON(128비트)과 가변 폭 SVE가 같은 자리에 있다 — 로봇 보드가 ARM이라면 이 절의 원리는 그대로 적용되고 명령 이름만 바뀐다.
:::

## 실측 ① — 같은 루프의 어셈블리: addsd가 vaddpd로

[8.3](#/codegen)에서 쓴 `g++ -S -masm=intel` 그대로, 가장 단순한 배열 덧셈의 전후를 뽑는다.

```cpp title="add.cpp"
void add_arrays(const double* a, const double* b, double* c, int n) {
    for (int i = 0; i < n; ++i)
        c[i] = a[i] + b[i];
}
```

먼저 벡터화를 끈 스칼라 판. (`-O2`가 이 모양의 루프를 어차피 벡터화하지 않는다는 건 [8.3](#/codegen)에서 실측했지만, 비교 조건을 명시적으로 못박기 위해 `-fno-tree-vectorize`를 붙인다.)

```console
$ g++ -std=c++20 -O2 -fno-tree-vectorize -S -masm=intel add.cpp -o add_scalar.s
```

```text nolines
.L3:                                         ; -O2 -fno-tree-vectorize, inner loop
        movsd   xmm0, QWORD PTR [rdi+rax]    ; load a[i]        (8 bytes)
        addsd   xmm0, QWORD PTR [rsi+rax]    ; + b[i]           (1 add)
        movsd   QWORD PTR [rdx+rax], xmm0    ; store c[i]
        add     rax, 8                       ; i += 1
        cmp     rcx, rax
        jne     .L3
```

한 바퀴에 double 하나. 이제 `-O3 -march=native`.

```console
$ g++ -std=c++20 -O3 -march=native -S -masm=intel add.cpp -o add_vector.s
```

```text nolines
.L5:                                         ; -O3 -march=native, inner loop
        vmovupd ymm1, YMMWORD PTR [rdi+rcx]  ; load a[i..i+3]   (32 bytes)
        vaddpd  ymm0, ymm1, YMMWORD PTR [rsi+rcx]  ; 4 adds in 1 instruction
        vmovupd YMMWORD PTR [rdx+rcx], ymm0  ; store c[i..i+3]
        add     rcx, 32                      ; i += 4 (32 bytes)
        cmp     rcx, r8
        jne     .L5
```

(g++ 13.3.0 / Ubuntu 24.04 x86-64 실측, 발췌. 이 `.s` 파일에는 이 루프 말고도 코드가 더 있다 — n이 4의 배수가 아닐 때 남는 원소를 처리하는 스칼라 꼬리(epilogue)와, `a`/`b`/`c`가 겹칠 때를 위한 별도 경로다. 뒤에서 다시 다룬다.) 명령 이름의 문법이 그대로 읽힌다: `addsd`의 `sd`(scalar double)가 `vaddpd`의 `pd`(**packed** double)로 바뀌었고, 레지스터가 `xmm`에서 `ymm`으로 넓어졌으며, 한 바퀴의 전진 폭이 8바이트에서 32바이트가 됐다. **루프 네 바퀴가 한 바퀴로 접힌 것이다.**

그런데 이 CPU는 AVX-512를 지원하는데 왜 `zmm`이 아니라 `ymm`인가. g++에게 512비트를 선호하라고 명시하면 실제로 나온다.

```text nolines
.L5:                                         ; -O3 -march=native -mprefer-vector-width=512
        vmovupd zmm1, ZMMWORD PTR [rdi+rdx]
        vaddpd  zmm0, zmm1, ZMMWORD PTR [r8+rdx]  ; 8 adds in 1 instruction
        vmovupd ZMMWORD PTR [rsi+rdx], zmm0
        add     rdx, 64
        cmp     rcx, rdx
        jne     .L5
```

::: deep GCC가 zmm을 기본으로 쓰지 않는 이유
`-march=native`를 줬는데도 g++ 13은 256비트를 선택했다 — 실측이다. GCC의 일반 튜닝이 512비트 사용을 보수적으로 잡아 두었기 때문인데, 배경에는 초기 AVX-512 구현들(서버용 Skylake 세대)이 512비트 명령을 밀도 있게 실행하면 코어 클럭을 낮추던 문제가 있다 — 벡터 폭으로 번 것을 클럭으로 되돌려주고, 같이 도는 스칼라 코드까지 느려지게 만드는 함정이었다. 최근 마이크로아키텍처에서는 이 페널티가 크게 줄었지만, 컴파일러 기본값은 여전히 신중하다. 교훈은 이 절 전체의 후렴과 같다: `-mprefer-vector-width=512`가 이득인지는 이론이 아니라 **당신의 CPU에서 잰 시간**이 결정한다.
:::

::: note 스칼라 부동소수점도 SIMD 레지스터에서 돈다
x86-64에서 double 연산은 벡터화 여부와 무관하게 전부 `xmm` 레지스터를 쓴다 — [8.3](#/codegen)의 모든 발췌에서 `xmm0`이 나온 이유다. 1980년대의 x87 부동소수점 스택을 SSE2가 대체하면서, "스칼라 연산 = SIMD 레지스터의 한 칸만 쓰는 연산"이 됐다. 그러니 `xmm`이 보인다고 벡터화된 게 아니다 — 접미사를 봐야 한다. `sd`/`ss`는 스칼라(double/float 하나), `pd`/`ps`는 packed(가득 채움)다.
:::

## 실측 ② — 시간으로 재면: L1에서 5.4배

어셈블리가 4배 접혔다고 시간이 4배 빨라진다는 보장은 없다 — 재야 안다. float 배열에 `c[i] = 2a[i] + b[i]`를 적용하는 커널로, 데이터가 L1 캐시에 들어가는 경우와 RAM을 왕복하는 경우를 각각 잰다.

```cpp title="bench.cpp"
#include <chrono>
#include <cstdio>
#include <vector>

// noinline: 호출부로 인라인되면 반복 루프와 뭉개져 측정 대상이 사라진다
__attribute__((noinline))
void axpy(const float* a, const float* b, float* c, int n) {
    for (int i = 0; i < n; ++i)
        c[i] = 2.0f * a[i] + b[i];
}

int main(int argc, char**) {
    {   // L1 상주: 4096 float = 배열당 16 KiB
        const int N = 4096;
        const long REPS = 500'000;
        std::vector<float> a(N, 1.0f), b(N, 2.0f), c(N);
        axpy(a.data(), b.data(), c.data(), N);  // 워밍업
        auto t0 = std::chrono::steady_clock::now();
        for (long r = 0; r < REPS; ++r) axpy(a.data(), b.data(), c.data(), N);
        auto t1 = std::chrono::steady_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        printf("L1  elapsed=%.1f ms  (checksum %.1f)\n", ms, (double)c[argc]);
    }
    {   // RAM 왕복: 20,000,000 float = 배열당 80 MB
        const int N = 20'000'000;
        const int REPS = 20;
        std::vector<float> a(N, 1.0f), b(N, 2.0f), c(N);
        axpy(a.data(), b.data(), c.data(), N);
        auto t0 = std::chrono::steady_clock::now();
        for (int r = 0; r < REPS; ++r) axpy(a.data(), b.data(), c.data(), N);
        auto t1 = std::chrono::steady_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        printf("RAM elapsed=%.1f ms  (checksum %.1f)\n", ms, (double)c[argc]);
    }
}
```

`c[argc]`를 출력하는 것은 [8.3](#/codegen)에서 실측한 함정 — 결과를 관찰하지 않으면 루프째 증발한다 — 의 방어다. 두 구간 모두 원소 갱신 횟수를 비슷한 자릿수로 맞췄다(L1: 4096×50만 = 20억 회, RAM: 2천만×20 = 4억 회).

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -fno-tree-vectorize bench.cpp -o bench_scalar
$ g++ -std=c++20 -Wall -Wextra -O3 -march=native      bench.cpp -o bench_vector
```

각 5회 실행 중앙값이다(g++ 13.3.0 / Ubuntu 24.04 x86-64, 이하 이 절의 모든 실측 동일 — 절대값은 기기마다 다르다).

| 구간 | 스칼라 빌드 | 벡터 빌드 | 배수 |
| --- | --- | --- | --- |
| L1 상주 (16 KiB × 3) | 1299.9 ms | 242.8 ms | **약 5.4배** |
| RAM 왕복 (80 MB × 3) | 377.4 ms | 366.2 ms | **약 1.03배** |

L1 구간의 5.4배부터. `ymm`은 float 8개를 담으므로 산술만 보면 이론 상한은 8배지만, 루프에는 산술 말고도 로드 2회·스토어 1회·카운터 갱신·분기가 있고 이것들이 전부 8분의 1로 줄지는 않는다 — 상한에 못 미치는 게 정상이고, 그래도 플래그 두 개로 5.4배면 이 책의 어떤 최적화와 견줘도 싼 이득이다.

## 실측 ③ — 메모리가 병목이면 SIMD는 논다

진짜 교훈은 둘째 줄이다. **같은 코드, 같은 플래그인데 배열이 커지자 이득이 사라졌다.** 벡터 빌드가 느려진 게 아니다 — 스칼라 빌드가 이미 연산이 아니라 메모리를 기다리고 있었던 것이다.

산수로 확인한다. RAM 구간은 원소 하나당 최소 12바이트를 메모리와 주고받는다(a와 b에서 8바이트 읽고 c에 4바이트 쓴다). 4억 회 갱신이면 최소 4.8 GB의 트래픽이고, 이걸 377 ms에 처리했으니 초당 약 13 GB — 이 수치가 연산 속도가 아니라 **이 환경의 메모리 대역폭**이다. [8.2](#/cache)의 계층 구조에서 본 그대로, L1은 코어에 붙어 있어 벡터 유닛을 먹여 살릴 수 있지만 DRAM은 그럴 수 없다. 연산 유닛을 8배로 늘려도 재료가 초당 13 GB밖에 안 들어오면 8배 빨리 노는 것뿐이다.

::: perf 벡터화 이득은 "연산 밀도"에 비례한다
이 실측의 L1 20억 회는 242.8 ms, RAM 4억 회는 366.2 ms — 원소당 시간으로 환산하면 L1 상주가 약 7.5배 빠르다(0.12 ns 대 0.92 ns). 같은 커널의 운명을 가른 것은 코드가 아니라 **데이터가 어느 계층에 있는가**다. 그래서 벡터화의 실전 순서는 "SIMD를 붙인다"가 아니라 "[8.2](#/cache)·[8.4](#/data-oriented)의 방법으로 워킹셋을 캐시에 넣고, 그 다음 SIMD를 붙인다"이다 — 순서를 바꾸면 이 표의 둘째 줄, 1.03배가 나온다. 바이트당 연산 횟수가 많은 커널(행렬 곱, 컨볼루션)일수록 벡터화 이득이 크고, 이 절의 덧셈처럼 원소당 연산이 한 줌인 커널은 캐시 밖에서는 대역폭이 전부다.
:::

## 벡터화를 막는 것들 — 리포트를 읽고, 고친다

[8.3](#/codegen)은 `-fopt-info-vec-missed`가 실패와 이유를 보고한다는 것까지 다뤘다. 이제 대표 차단 패턴 세 개를 하나씩 실측하고, 고칠 수 있는 것은 고쳐서 벡터화가 성사되는 것까지 확인한다. 모든 컴파일은 `-O3 -march=native` 기준이다.

### 차단 ① 루프 중간의 조기 탈출

```cpp title="branch.cpp"
int find_first_negative(const float* a, int n) {
    for (int i = 0; i < n; ++i)
        if (a[i] < 0.0f) return i;
    return -1;
}
```

```console
$ g++ -std=c++20 -O3 -march=native -fopt-info-vec-missed -c branch.cpp
branch.cpp:3:15: missed: couldn't vectorize loop
branch.cpp:3:15: missed: not vectorized: control flow in loop.
```

[8.3](#/codegen)의 `sum_until`과 같은 진단이다. 원소 8개를 한꺼번에 처리하려면 "8개를 다 읽어도 된다"는 보장이 필요한데, `return`이 있는 루프는 몇 번째에서 멈출지 실행 전에 알 수 없다. 분기 **자체**가 문제가 아니라는 게 중요하다 — 탈출 없는 분기로 고치면:

```cpp title="branch_fixed.cpp"
int count_negatives(const float* a, int n) {
    int cnt = 0;
    for (int i = 0; i < n; ++i)
        if (a[i] < 0.0f) ++cnt;   // 분기는 있지만 조기 탈출이 없다
    return cnt;
}
```

```console
$ g++ -std=c++20 -O3 -march=native -fopt-info-vec -c branch_fixed.cpp
branch_fixed.cpp:3:23: optimized: loop vectorized using 32 byte vectors
branch_fixed.cpp:3:23: optimized: loop vectorized using 16 byte vectors
```

성공이다. 컴파일러는 이런 분기를 비교 마스크와 블렌드 명령으로 바꾼다(if-conversion) — "8개 전부에 대해 조건을 평가하고, 참인 레인만 골라 반영"하는 방식이라 제어 흐름이 데이터 흐름이 된다. 알고리즘이 허락한다면 "처음 것을 찾고 멈추기"보다 "전부 세기/전부 계산하기"가 벡터화 친화적이다 — 대량 데이터에서는 분기 없이 다 훑는 쪽이 실제로 빠른 경우가 많다는 것을 [8.4](#/data-oriented)의 분기 예측 실측이 이미 보여줬다.

### 차단 ② 진짜 데이터 의존성

```cpp title="dep.cpp"
void prefix_sum(float* a, int n) {
    for (int i = 1; i < n; ++i)
        a[i] += a[i - 1];   // 이번 바퀴가 직전 바퀴의 결과를 쓴다
}
```

```console
$ g++ -std=c++20 -O3 -march=native -fopt-info-vec-missed -c dep.cpp
dep.cpp:2:23: missed: couldn't vectorize loop
dep.cpp:3:12: missed: not vectorized: no vectype for stmt: _4 = *_3;
```

이번 진단문은 불친절하다 — `no vectype`는 내부 분석이 실패한 지점의 표현일 뿐 원인이 아니다. 원인을 보려면 상세 덤프를 뜬다: `-fdump-tree-vect-details`로 컴파일하면 `dep.cpp.*.vect` 파일에 `bad data dependence.`와 `dependence distance = 1`이 찍힌다(실측). 거리 1의 의존 — `a[i]`가 `a[i-1]`에 의존 — 은 8개를 동시에 계산하는 순간 깨진다. 이것은 코드 스타일 문제가 아니라 **알고리즘이 순차적인 것**이라, `__restrict`도 플래그도 소용없다. (병렬 프리픽스 합 알고리즘으로 재설계하는 길이 있긴 하지만 그건 코드를 고치는 게 아니라 알고리즘을 바꾸는 일이다.) 벡터화를 원하면 의존이 애초에 없는 형태 — 각 원소가 자기 입력만 읽는 맵(map) 꼴 — 로 계산을 설계하는 게 정공법이다.

### 차단 ③ 포인터 앨리어싱 — 컴파일러의 보험료를 `__restrict`로 없앤다

실측 ①의 어셈블리에 "겹칠 때를 위한 별도 경로"가 있다고 했다. 그 정체가 [8.3](#/codegen)에서 본 이 보고다.

```console
$ g++ -std=c++20 -O3 -march=native -fopt-info-vec -c alias.cpp
alias.cpp:2:23: optimized: loop vectorized using 32 byte vectors
alias.cpp:2:23: optimized:  loop versioned for vectorization because of possible aliasing
alias.cpp:2:23: optimized: loop vectorized using 16 byte vectors
```

`const float* a, float* c`만 받는 함수에서 컴파일러는 `a`와 `c`가 같은 배열의 다른 구간일 가능성을 배제할 수 없다 — 겹치면 벡터 로드가 아직 갱신 전인 값과 갱신 후인 값을 섞어 읽어 결과가 달라진다. 그래서 g++은 포기하는 대신 **루프 버전 분기(loop versioning)** — [8.3](#/codegen)의 보고에서 `versioned`라는 단어로 이미 만났다 — 를 한다: 실행 시점에 두 포인터의 겹침을 검사해서 벡터판/스칼라판으로 갈라지는 코드를 둘 다 만든다. 벡터화는 됐지만 호출마다 검사 비용을 내고, 코드는 두 벌이다. 겹치지 않는다는 것을 당신이 알면 그 사실을 타입에 새길 수 있다.

```cpp title="alias_fixed.cpp — __restrict: 겹치지 않는다는 약속"
void scale_add(const float* __restrict a, float* __restrict c, int n) {
    for (int i = 0; i < n; ++i)
        c[i] = 2.0f * a[i] + c[i];
}
```

```console
$ g++ -std=c++20 -O3 -march=native -fopt-info-vec-all -c alias_fixed.cpp 2>&1 | grep -E "version|vectorized"
alias_fixed.cpp:1:6: note: vectorized 1 loops in function.
alias_fixed.cpp:2:23: optimized: loop vectorized using 32 byte vectors
alias_fixed.cpp:2:23: optimized: loop vectorized using 16 byte vectors
```

`versioned` 줄이 사라졌다(실측) — 런타임 검사도, 스칼라 예비판도 없이 곧장 벡터 루프다. `__restrict`는 표준 C++ 키워드가 아니라 C99의 `restrict`를 GCC/Clang/MSVC가 C++에 확장한 것이지만, 셋 다 지원해서 실무에서 사실상 이식성 있게 쓰인다.

::: warn __restrict는 약속이지 검사가 아니다
`__restrict`를 붙이고 실제로 겹치는 포인터를 넘기면 컴파일러는 약속을 믿고 만든 벡터 코드를 그대로 실행한다 — 결과는 미정의 동작이고, [2.11](#/ub-sanitizers)에서 본 UB들과 달리 새니타이저도 이 거짓말은 잡아 주지 못한다. 조용히 틀린 숫자만 나온다. 붙이기 전에 "이 함수의 모든 호출 지점에서 정말 겹칠 수 없는가"를 확인하고, 겹칠 수 있는 API(예: 사용자가 임의 버퍼를 넘기는 공개 함수)에는 붙이지 마라 — 그 자리는 버전 분기 비용이 곧 보험료다.
:::

## "loop vectorized" 리포트를 끝까지 믿지 마라

[8.3](#/codegen)에서 부동소수점 리덕션 루프는 `missed`로 보고됐고, `-ffast-math`를 줘야 벡터화됐다 — 덧셈 순서 재배열이 결과 비트를 바꾸기 때문이다. 그런데 더 단순한 리덕션은 한 술 더 뜬 행동을 한다. 이 절에서 가장 중요한 실측이다.

```cpp title="reduce.cpp"
float sum(const float* a, int n) {
    float s = 0.0f;
    for (int i = 0; i < n; ++i)
        s += a[i];
    return s;
}
```

```console
$ g++ -std=c++20 -O3 -march=native -fopt-info-vec -c reduce.cpp
reduce.cpp:3:23: optimized: loop vectorized using 32 byte vectors
```

`-ffast-math` 없이 **"vectorized"라고 보고한다.** 그런데 어셈블리를 열면:

```text nolines
.L4:                                         ; -O3 -march=native, no -ffast-math
        vaddss  xmm0, xmm0, DWORD PTR [rax]  ; scalar add, one float
        add     rax, 32
        vaddss  xmm0, xmm0, DWORD PTR -28[rax]
        vaddss  xmm0, xmm0, DWORD PTR -24[rax]
        vaddss  xmm0, xmm0, DWORD PTR -20[rax]
        vaddss  xmm0, xmm0, DWORD PTR -16[rax]
        vaddss  xmm0, xmm0, DWORD PTR -12[rax]
        vaddss  xmm0, xmm0, DWORD PTR -8[rax]
        vaddss  xmm0, xmm0, DWORD PTR -4[rax]
        cmp     rax, rdx
        jne     .L4
```

`vaddss` — scalar single — 여덟 개가 **한 줄로 사슬처럼** 이어져 있고, 전부 직전 결과(`xmm0`)에 의존한다. 루프를 8개씩 묶긴 했지만 덧셈은 소스에 쓴 순서 그대로 하나씩 한다 — IEEE 754 결과를 보존하는 순서 유지(in-order) 리덕션이다. 보고서는 거짓말을 하지 않았지만("루프를 벡터 단위로 처리했다"), 당신이 기대한 병렬 덧셈은 거기 없다. `-ffast-math`를 주면 진짜가 나온다:

```text nolines
.L4:                                         ; + -ffast-math
        vaddps  ymm1, ymm1, YMMWORD PTR [rax]  ; 8 adds in 1 instruction
        add     rax, 32
        cmp     rdx, rax
        jne     .L4
```

시간 차이를 쟀다. L1 상주 4096개 배열을 50만 번 합산(누적 20억 회 덧셈), 5회 중앙값:

| 빌드 | 실행 시간 | 배수 |
| --- | --- | --- |
| `-O3 -march=native` (순서 유지) | 2483.3 ms | 1.0배 |
| `-O3 -march=native -ffast-math` | 284.9 ms | **약 8.7배** |

::: perf 8.7배의 정체는 덧셈 지연시간의 사슬이다
순서 유지판의 20억 회 ÷ 2483 ms ≈ 덧셈당 1.24 ns — 이 CPU(기본 클럭 2.8 GHz) 기준 약 3.5사이클로, 최신 x86 코어의 부동소수점 덧셈 지연시간(3~4사이클)과 맞아떨어진다. 여덟 개의 덧셈이 전부 직전 결과를 기다리는 사슬이라, CPU가 아무리 많은 유닛을 가져도 한 번에 하나씩만 진행된다. `-ffast-math`판은 `ymm` 누산기 하나로 8레인이 독립적으로 굴러가서 사슬이 8분의 1로 짧아진다 — 배수가 레인 수와 거의 정확히 일치하는 이유다. 그리고 이 벤치마크에는 함정이 하나 더 있었다: `sum`은 인자만 읽는 순수 함수라 `noinline`만으로는 g++이 호출을 반복 루프 밖으로 끌어올려 버린다(실측 — 0.6 ms라는 비현실적 수치가 나왔다). 측정 코드에는 `__attribute__((noipa))`를 써서 프로시저 간 분석까지 끊어야 했다 — 이런 함정의 체계적 정리가 [8.6 마이크로벤치마크의 함정](#/benchmarking)이다.
:::

`-ffast-math`가 정확도 계약의 변경이라는 경고는 [8.3](#/codegen)의 `::: danger`가 이미 했다 — 칼만 필터([9.6](#/state-estimation))처럼 수치 안정성이 아슬아슬한 코드에 전역으로 켜는 것은 도박이고, 켠다면 파일 단위로 결과 검증과 함께다. 재배열만 허용하는 좁은 플래그(`-fassociative-math`와 그 동반 플래그들)도 있지만, 어느 쪽이든 원칙은 하나다: **"vectorized" 리포트는 시작점이고, 판정은 어셈블리와 시간이 한다.**

## SoA가 아니면 벡터 레인이 절반은 빈 채로 돈다

`vmovupd` 한 번은 **연속된** 32바이트를 퍼 올린다 — 벡터 로드에 "4바이트 건너뛰며 읽기" 같은 싼 모드는 없다. 그래서 [8.4](#/data-oriented)에서 눕혀 놓은 데이터 배치가 벡터화의 전제 조건이 된다. 포인트 구조체 배열(AoS)에서 x좌표만 갱신하는 루프와, 필드별 배열(SoA)의 x 배열을 갱신하는 루프를 비교한다.

```cpp title="soa.cpp — 같은 갱신, 두 가지 배치"
struct PointAoS { float x, y, z; };

// AoS: x를 읽으려면 y, z가 낀 12바이트 간격으로 건너뛰어야 한다
void shift_x_aos(PointAoS* pts, int n, float dx) {
    for (int i = 0; i < n; ++i)
        pts[i].x += dx;
}

// SoA: x만 모인 연속 배열
void shift_x_soa(float* __restrict xs, int n, float dx) {
    for (int i = 0; i < n; ++i)
        xs[i] += dx;
}
```

`-O3 -march=native -fopt-info-vec`은 **두 루프 모두** "loop vectorized"로 보고한다(실측) — 리포트만 보면 차이가 없다. 그러나 생성된 어셈블리에서 AoS 판에는 `vpermt2ps`·`vextractps` 같은, 레지스터 안에서 값을 재배열하는 셔플 계열 명령이 11개 들어갔고 SoA 판에는 0개다(실측, `grep -cE "vperm|vshuf|vblend|vinsert|vextract|vunpck"`). x·y·z가 섞여 로드된 레지스터에서 x만 골라 모으고, 계산 후 다시 제자리에 흩어 넣는 비용이다. L1 상주 4096원소 × 50만 회 반복, 5회 중앙값:

| 배치 | 실행 시간 | 배수 |
| --- | --- | --- |
| AoS (`PointAoS[]`) | 808.3 ms | 7.5배 느림 |
| SoA (`float xs[]`) | 107.9 ms | 1.0배 |

::: perf 셔플 비용 + 대역폭 낭비 = 7.5배
격차의 두 축이다. 첫째, AoS는 x 하나를 갱신하기 위해 캐시에서 y·z까지 12바이트를 끌고 온다 — 유효 대역폭이 3분의 1이다([8.4](#/data-oriented)의 hot/cold 실측과 같은 병리다). 둘째, 레인 정리용 셔플 11개가 매 반복 덧셈 명령보다 많은 일을 한다. "vectorized"라는 같은 보고를 받고도 7.5배가 갈렸다 — SoA는 SIMD의 선택 사항이 아니라 전제 조건이다. PCL([11.6](#/pcl))의 포인트 타입들이 SIMD 정렬을 위해 16바이트 경계에 패딩되는 것도, Eigen이 행렬 데이터를 연속·정렬 저장하는 것도 전부 이 표 때문이다.
:::

## 인트린식 맛보기 — 그리고 왜 최후 수단인가

자동 벡터화가 안 통하는 지점에서 벡터 명령을 직접 쓰는 길이 인트린식(intrinsics)이다. `<immintrin.h>`가 명령마다 함수 모양의 래퍼를 제공한다 — `_mm256_add_pd`는 `vaddpd` 그 자체다.

```cpp title="intrin.cpp — vaddpd를 손으로 부른다"
#include <immintrin.h>
#include <cstdio>

int main() {
    alignas(32) double a[4] = {1.0, 2.0, 3.0, 4.0};
    alignas(32) double b[4] = {10.0, 20.0, 30.0, 40.0};
    alignas(32) double c[4];

    __m256d va = _mm256_load_pd(a);      // ymm 레지스터로 double 4개 로드
    __m256d vb = _mm256_load_pd(b);
    __m256d vc = _mm256_add_pd(va, vb);  // 한 명령으로 덧셈 4개
    _mm256_store_pd(c, vc);

    printf("%.1f %.1f %.1f %.1f\n", c[0], c[1], c[2], c[3]);
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -mavx intrin.cpp -o intrin && ./intrin
11.0 22.0 33.0 44.0
```

(실측. `-mavx` 없이 컴파일하면 ABI 경고가 쏟아진다 — 인트린식은 해당 명령 세트의 허가 플래그가 필수다.) `__m256d`는 "double 4개가 실린 256비트 값" 타입이고, `alignas(32)`는 정렬 로드(`_mm256_load_pd`)의 요구 조건이다. 이 정도 수준까지는 읽고 쓸 줄 알아야 한다 — 라이브러리 소스나 SIMD 최적화된 코드를 읽을 때 만나기 때문이다.

그러나 **실무의 기본은 이 절 앞부분의 순서다.** ① 데이터를 SoA로 눕히고([8.4](#/data-oriented)), ② `-O3 -march=<타깃>`을 켜고, ③ `-fopt-info-vec-missed`로 막힌 곳을 찾아 코드를 고치고, ④ 어셈블리와 시간으로 판정한다. 인트린식은 이 네 단계가 다 통하지 않을 때의 최후 수단이다 — CPU 아키텍처마다 코드가 갈리고(AVX 코드는 ARM 보드에서 컴파일조차 안 된다), 컴파일러가 새 CPU에서 알아서 좋아지는 이득을 포기하며, 가독성 비용이 크다.

::: tip 로보틱스 수학은 Eigen이 SIMD를 공짜로 준다
Part IX의 모든 수학 — 좌표 변환, 자코비안, 필터 — 은 Eigen([9.1](#/eigen)) 위에서 돈다. Eigen은 내부가 인트린식으로 벡터화돼 있고 컴파일 플래그에 맞춰 SSE/AVX/NEON 경로를 스스로 고른다. 즉 `Eigen::Matrix4f` 곱셈을 쓰는 순간 이 절의 이득을 코드 한 줄 안 바꾸고 얻는다 — 로봇 수학 커널에 인트린식을 직접 쓸 일은 사실상 없다. 당신이 챙길 것은 두 가지뿐이다: 데이터가 Eigen 타입으로 연속 저장돼 있을 것, 빌드에 적절한 `-march`/`-O` 플래그가 켜져 있을 것.
:::

::: interview "SIMD 최적화를 어떻게 접근하겠는가"
성능 직군 면접의 단골이다. "인트린식으로 짜겠다"로 시작하면 하수다. 답변 뼈대: ① 먼저 프로파일로 그 루프가 병목인지, 병목이 연산인지 대역폭인지 확인한다(이 절 실측: 대역폭 병목이면 벡터화 이득이 1.0배다). ② 데이터 레이아웃을 SoA로 정리한다 — 벡터 로드는 연속 메모리를 전제하고, AoS는 "vectorized" 리포트가 떠도 셔플로 이득을 잃는다(실측 7.5배 차). ③ 컴파일러 자동 벡터화 + `-fopt-info-vec-missed`로 차단 요인(조기 탈출, 의존성, 앨리어싱)을 제거한다. ④ 그래도 안 되는 커널만 인트린식 또는 검증된 라이브러리(Eigen, xsimd류)로 내려간다. 각 단계에 "측정으로 판정"을 붙이면 상급이다.
:::

## -march=native의 함정 — 그 바이너리는 로봇에서 죽는다

`-march=native`는 "**이 빌드 머신**의 모든 확장을 써라"다. 편하지만, 빌드 머신과 실행 머신이 다른 순간 흉기가 된다. AVX-512가 있는 개발 PC에서 `-march=native`로 빌드한 바이너리를 AVX-512가 없는 CPU에서 실행하면, 첫 `zmm` 명령에서 프로세스가 `SIGILL`(illegal instruction)로 즉사한다 — 컴파일 에러도, 링크 에러도, 친절한 메시지도 없다. 로봇 개발은 정확히 이 조건이다: 개발 PC는 최신 x86, 로봇 보드는 구형 x86이거나 아예 ARM(라즈베리파이, Jetson)이다.

원칙은 [7.2](#/cmake-advanced)의 크로스 컴파일 규율과 하나로 붙는다. **배포 바이너리의 `-march`는 실행 타깃의 CPU로 명시**한다 — x86 로봇 보드라면 그 보드가 지원하는 수준(예: `-march=x86-64-v2`), ARM이라면 크로스 툴체인과 해당 `-mcpu`다. `-march=native`는 "빌드한 그 자리에서만 도는 것" — 개발 중 벤치마크, CI 성능 테스트 — 에만 쓴다. 이 절의 실측 수치들이 전부 `-march=native`인 것은 그것들이 전부 이 머신에서만 돌 벤치마크이기 때문이다.

::: tip CMake에서는 타깃별로 못박는다
`target_compile_options(fast_kernel PRIVATE -O3 -march=x86-64-v2)`처럼 성능 커널 타겟에 명시적으로 건다. 워크스페이스 전체에 `-march=native`를 박아 두면 언젠가 누군가의 CI 아티팩트가 로봇 위에서 `SIGILL`로 죽는다 — 그리고 그 크래시는 스택 트레이스에 벡터 명령 주소만 남겨서, 원인을 아는 사람에게만 5분거리다. colcon 워크스페이스에서 이 플래그를 어디에 두는가는 [7.2](#/cmake-advanced)의 툴체인 파일 이야기와 이어진다.
:::

## 요약

- SIMD는 한 명령이 레지스터에 나란히 실린 여러 값에 같은 연산을 적용하는 실행 방식이다 — SSE 128비트(double 2개), AVX/AVX2 256비트(4개), AVX-512 512비트(8개). 지원 여부는 `/proc/cpuinfo`와 `gcc -march=native -Q --help=target`으로 확인한다(이 환경: AVX-512까지 전부 지원).
- 실측 ①: 같은 배열 덧셈 루프가 `-O2 -fno-tree-vectorize`에서는 `addsd`(바퀴당 double 1개), `-O3 -march=native`에서는 `vaddpd ymm`(4개)이 된다 — `-march` 허가 없이 g++은 SSE2 128비트까지만 쓰고, AVX-512가 있어도 기본값은 `ymm`이다(`-mprefer-vector-width=512`로 `zmm` 확인).
- 실측 ②·③: L1 상주 데이터에서는 5.4배, RAM을 왕복하면 1.03배 — 벡터화 이득은 데이터가 어느 캐시 계층에 있는가에 달렸고, 대역폭 병목(이 환경 약 13 GB/s)에서는 연산 유닛을 늘려도 소용없다.
- 벡터화 차단 3종과 처방: 조기 탈출(`control flow in loop`)은 탈출 없는 전량 처리로, 앨리어싱(런타임 검사 딸린 루프 버전 분기)은 `__restrict`로 — 단 거짓 약속은 새니타이저도 못 잡는 UB다. 거리 1의 진짜 데이터 의존(누적 합)은 코드 수선으로는 못 고친다.
- "loop vectorized" 리포트는 판정이 아니다 — 순서 유지 리덕션은 "vectorized"로 보고되면서 `vaddss` 사슬로 돌았고(`-ffast-math`로 8.7배), AoS도 "vectorized"로 보고되면서 셔플 11개를 안고 SoA보다 7.5배 느렸다. 판정은 어셈블리와 시간이 한다.
- 실무 순서: SoA 배치 → 타깃에 맞는 `-march`/`-O3` → `-fopt-info-vec-missed`로 차단 제거 → 측정. 인트린식(`_mm256_add_pd` 등)은 최후 수단이고, 로보틱스 수학은 Eigen([9.1](#/eigen))이 내부 벡터화로 공짜로 준다.
- `-march=native` 바이너리는 빌드 머신 전용이다 — 로봇 보드 배포본은 타깃 CPU를 명시하지 않으면 `SIGILL`로 즉사한다([7.2](#/cmake-advanced) 크로스 컴파일).

::: quiz 연습문제
1~3번은 개념·예측 문제, 4~5번은 네 컴퓨터에서 직접 실측하는 문제다.

1. `ymm` 레지스터 하나에 float은 몇 개, double은 몇 개 들어가는가. 그리고 [8.3](#/codegen)의 벡터화 보고가 전부 "16 byte vectors"였는데 이 절에서 "32 byte vectors"가 나온 이유를 컴파일 플래그로 설명하라.

2. 이 절에는 `-fopt-info-vec`이 "loop vectorized"라고 보고했는데도 기대한 성능이 나오지 않은 사례가 둘 있다. 각각 무엇이었고, 리포트만으로 놓친 것을 무엇으로 확인했는지 써라.

3. (예측) 실측 ②의 RAM 구간(80 MB 배열)을 `-mprefer-vector-width=512`로 다시 빌드해 `zmm`을 쓰게 하면 실행 시간이 유의미하게 줄어들까? 이 절의 실측 수치를 근거로 예측하라.

4. (실습, 코드 작성형) `void saxpy(float* __restrict y, const float* __restrict x, float a, int n)` — `y[i] += a * x[i]` — 를 직접 작성하고 `g++ -std=c++20 -Wall -Wextra -O3 -march=native -fopt-info-vec -S -masm=intel saxpy.cpp -o saxpy.s`로 컴파일하라. 성공 기준 두 가지: ① `optimized: loop vectorized using 32 byte vectors` 보고가 뜨고 `versioned` 줄이 없을 것, ② `saxpy.s`의 내부 루프에서 `ymm`을 쓰는 곱셈-덧셈(이 CPU라면 `vfmadd` 계열 하나로 붙는다)을 찾을 것.

5. (실습) 4번에서 `__restrict` 두 개를 지우고 `-fopt-info-vec-all`로 다시 컴파일해 `loop versioned for vectorization because of possible aliasing` 줄이 나타나는 것을 확인하라. 그다음 `.s` 파일에서 스칼라 예비 루프(`ss` 접미사 명령들)가 벡터 루프와 함께 들어 있는 것까지 찾아라 — 버전 분기가 "코드 두 벌 + 런타임 검사"라는 것을 눈으로 확인하는 게 목적이다.
:::

::: answer 해설
1. `ymm`은 256비트 = float(32비트) 8개 = double(64비트) 4개. [8.3](#/codegen)은 `-march` 계열 플래그 없이 컴파일했으므로 g++이 x86-64 기준선인 SSE2의 128비트(16바이트) 벡터만 썼다. 이 절은 `-march=native`로 이 CPU의 AVX/AVX2를 허가해서 256비트(32바이트) 벡터가 나왔다 — CPU가 명령을 갖고 있어도 컴파일러에게 허가하지 않으면 잠들어 있다.

2. ① 순서 유지 리덕션: `reduce.cpp`가 "vectorized using 32 byte vectors"로 보고됐지만 내부 루프는 `vaddss` 8개의 직렬 사슬이었다 — 어셈블리(`-S`)로 확인했고, `-ffast-math` 판과의 시간 비교(2483.3 ms 대 284.9 ms)로 8.7배 차이를 확인했다. ② AoS 배치: `shift_x_aos`도 "vectorized"로 보고됐지만 셔플 명령 11개가 끼었고 SoA보다 7.5배 느렸다 — 역시 어셈블리의 셔플 명령 수와 실행 시간으로 확인했다. 공통 교훈: 리포트는 시작점, 판정은 어셈블리와 시간.

3. 유의미하게 줄지 않는다고 예측해야 한다. 실측 ③에서 RAM 구간은 256비트 벡터화조차 1.03배밖에 못 얻었다 — 병목이 연산이 아니라 약 13 GB/s의 메모리 대역폭이었기 때문이다. 벡터 폭을 512비트로 늘리는 것은 연산 처리량을 늘리는 조치라, 대역폭 병목에는 아무 효과가 없다. 반대로 L1 구간이라면 폭 확대가 효과를 낼 수 있다 — 그것도 예측이 아니라 측정으로 확인할 일이다.

4. `__restrict`가 양쪽에 붙어 있고 루프에 탈출·의존이 없으므로 버전 분기 없이 곧장 벡터화돼야 한다. 이 CPU처럼 FMA를 지원하는 환경이면 내부 루프에 `vfmadd132ps`/`vfmadd213ps` 류의 `ymm` 명령이 나온다 — 곱셈과 덧셈이 명령 하나로 붙는 fused multiply-add로, `a * x[i] + y[i]` 모양의 커널에서 컴파일러가 자동으로 쓴다. 보고와 어셈블리가 네 화면에서 일치하는 것까지가 성공 기준이다.

5. `__restrict`를 지우면 컴파일러가 `x`와 `y`의 겹침을 배제할 수 없어 `loop versioned ...` 줄이 나타난다. `.s` 파일에는 겹침을 검사하는 포인터 비교, `ymm` 벡터 루프, 그리고 겹칠 때를 위한 `vmovss`/`vfmadd...ss` 류 스칼라 루프가 전부 들어 있다 — 같은 함수의 몸이 두 벌이 된 것이다. 호출마다 내는 검사 비용과 코드 크기가 `__restrict` 한 쌍의 가격표라는 것을 확인했으면 목적 달성이다.
:::

이 절의 실측은 전부 네 기기에서 재현해라 — 절대값은 다르게 나와도 "L1에서 수 배, RAM에서 제자리"라는 구조는 같아야 한다. 기준 명령: 어셈블리 비교는 `g++ -std=c++20 -O2 -fno-tree-vectorize -S -masm=intel add.cpp -o add_scalar.s`와 `-O3 -march=native` 판을 나란히 놓고 `addsd`/`vaddpd`를 찾는다. 시간 비교는 `g++ -std=c++20 -Wall -Wextra -O2 -fno-tree-vectorize bench.cpp -o bench_scalar && g++ -std=c++20 -Wall -Wextra -O3 -march=native bench.cpp -o bench_vector`로 두 벌을 빌드해 각각 5회씩 돌린다. 차단 패턴은 `g++ -std=c++20 -O3 -march=native -fopt-info-vec -fopt-info-vec-missed -c <파일>`로 리포트를 받는다.

**다음 절**: [8.6 마이크로벤치마크의 함정](#/benchmarking) — 이 절에서도 순수 함수가 루프 밖으로 끌려 나가 0.6 ms라는 가짜 수치를 만들었다. 죽은 코드 제거·상수 접기와 싸우며 올바르게 재는 법, 그리고 Google Benchmark를 다룬다.

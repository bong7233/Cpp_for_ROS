# 8.6 마이크로벤치마크의 함정

::: lead
[8.1](#/profiling)에서 "추측하지 말고 측정하라"로 시작한 이 Part는, 마지막 절에서 그 명제를 한 번 뒤집는다 — **"측정했다"와 "제대로 측정했다"는 다르다.** 함수 하나의 실행 시간을 재는 마이크로벤치마크는 겉보기엔 `std::chrono`로 시각 두 번 찍으면 끝나는 일 같지만, 실제로 해 보면 컴파일러가 측정 대상을 통째로 지워 버리고, 첫 실행의 콜드 스타트가 수치를 오염시키고, 같은 코드가 실행할 때마다 다른 숫자를 낸다. 이 절은 그 함정 셋을 전부 이 환경에서 실측으로 재현한 뒤, Google Benchmark를 [7.6](#/googletest)의 GoogleTest처럼 FetchContent로 실제로 받아 빌드해서 각 함정이 어떻게 처리되는지 실제 출력으로 확인한다. Part VIII의 마무리답게, 앞 다섯 절이 가르친 최적화가 "정말 빨라졌는가"를 증명하는 마지막 단계다.
:::

## 함정 1: 잰 것은 아무것도 아니었다

가장 순진한 벤치마크부터 시작한다. 100만 원소 `vector<double>`의 합을 100번 계산하고, 전후로 `std::chrono::steady_clock`을 찍는다.

```cpp title="naive.cpp — 결과를 안 쓰는 측정"
#include <chrono>
#include <cstdio>
#include <vector>

// 100만 원소 벡터의 합 -- 측정하고 싶은 대상
double sum(const std::vector<double>& v) {
    double s = 0.0;
    for (double x : v) s += x;
    return s;
}

int main() {
    std::vector<double> v(1'000'000, 1.5);

    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 100; ++i) {
        sum(v);                       // ❌ 결과를 아무 데도 안 쓴다
    }
    auto t1 = std::chrono::steady_clock::now();

    auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();
    std::printf("total %lld ns, per call %.1f ns\n",
                static_cast<long long>(ns), ns / 100.0);
}
```

같은 코드를 `-O0`과 `-O2`로 컴파일해서 각각 돌렸다.

```console
$ g++ -std=c++20 -Wall -Wextra -O0 naive.cpp -o naive_O0 && ./naive_O0
total 800158751 ns, per call 8001587.5 ns
$ g++ -std=c++20 -Wall -Wextra -O2 naive.cpp -o naive_O2 && ./naive_O2
total 119 ns, per call 1.2 ns
```

(g++ 13.3.0 / Ubuntu 24.04 실측.) `-O0`에서는 호출당 8.0ms — 100만 번의 덧셈이 실제로 돌았다. `-O2`에서는 호출당 **1.2ns**. 100만 개의 `double`을 1.2ns에 더하는 하드웨어는 존재하지 않는다 — 덧셈 하나에 0.0000012ns라는 뜻이 되는데, 이 CPU의 클럭 한 사이클이 0.36ns다. 결론은 하나다. **루프가 실행되지 않았다.** [8.3](#/codegen)에서 본 죽은 코드 제거(dead code elimination)가 정확히 이 일을 했다 — `sum(v)`의 결과는 아무 데도 쓰이지 않고, `sum`은 부수효과가 없으므로, 컴파일러는 호출 100번을 통째로 지우는 것이 합법이라고 증명하고 지웠다. 남은 119ns는 시각 두 번 찍는 비용이다. 이 벤치마크는 "빈 코드의 실행 시간"을 정밀하게 측정한 것이다.

::: warn -O0으로 재는 것은 답이 아니다
"그럼 `-O0`으로 재면 되겠네"는 반대 방향으로 틀린다. 위 실측에서 `-O0`은 `-O2`가 살아 있을 때보다도 수십 배 느린 코드를 만든다([8.3](#/codegen)에서 본 그대로다) — 그 8.0ms는 당신이 배포할 일 없는 바이너리의 시간이다. `-O0` 벤치마크로 알고리즘 A가 B보다 빠르다고 결론 내려도, `-O2`에서는 순위가 뒤집힐 수 있다 — 인라인·벡터화가 A와 B에 다르게 적용되기 때문이다. **측정은 반드시 배포와 같은 최적화 레벨로 한다.** 그래서 벤치마크의 진짜 문제는 "최적화를 끄느냐"가 아니라 "최적화를 켠 채로 측정 대상만 살려 두느냐"다.
:::

## 결과를 쓰면 해결되는가 — 절반만

첫 번째 반사적 수정은 결과를 쓰는 것이다. `total += sum(v)`로 누적해서 마지막에 출력하게 고치고 다시 쟀다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 naive2.cpp -o naive2_O2 && ./naive2_O2
total=150000000, per call 651557.4 ns
```

(실측.) 호출당 651µs — 이번엔 그럴듯한 수치가 돌아왔다. 결과가 `printf`까지 흘러가므로 컴파일러가 계산을 지울 수 없었다. 그럼 "결과를 쓰기만 하면 안전"인가. 아니다. 입력이 컴파일 타임에 알려진 경우를 보자 — 1부터 10억까지 더하는 루프를 재고, 결과를 **출력까지 한다.**

```cpp title="naive3.cpp — 결과를 쓰는데도 죽는 측정 (핵심부)"
long long sum_to(long long n) {
    long long s = 0;
    for (long long i = 0; i < n; ++i) s += i;
    return s;
}
// main()에서: 시각 찍고 sum_to(1'000'000'000) 호출, 결과와 시간을 printf
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 naive3.cpp -o naive3_O2 && ./naive3_O2
s=499999999500000000, 83 ns
```

(실측.) 10억 번 반복이 83ns. 결과값은 정확한데 시간이 말이 안 된다. `-S`로 어셈블리를 열어 보면 이유가 그대로 보인다.

```console
$ g++ -std=c++20 -O2 -S naive3.cpp -o - | grep 4999999995
	movabsq	$499999999500000000, %rdx
```

**답이 바이너리에 상수로 박혀 있다.** g++가 이 루프의 최종 값을 닫힌 식($n(n-1)/2$)으로 계산해 컴파일 타임에 끝냈다 — [8.3](#/codegen)에서 본 최적화의 연장선이고, 실행 시점에는 상수 하나를 레지스터에 싣는 일만 남았다. 83ns는 그 `movabsq`와 시계 비용이다.

::: danger 컴파일러와의 군비 경쟁은 손으로 이길 수 없다
"결과를 쓴다"는 규칙 하나로는 부족하다는 게 이 실측의 요점이다. 결과를 출력해도 입력이 상수면 계산이 컴파일 타임으로 이동하고, 입력을 변수로 바꿔도 루프 불변 코드 이동·인라인·최종 값 치환이 측정 대상을 조용히 변형한다. 그리고 컴파일러는 버전이 올라갈 때마다 더 똑똑해진다 — 오늘 살아남은 수제 벤치마크가 다음 g++에서 0ns가 되는 일은 실제로 일어난다. 이 문제를 표준적으로 처리하는 도구가 필요한 이유고, 그게 Google Benchmark다.
:::

## Google Benchmark를 FetchContent로 받아온다

[7.6](#/googletest)에서 GoogleTest를 받았던 방식 그대로다. 실제로 이 환경에서 받아 빌드해 실행까지 확인했다 — 아래 수치는 전부 그 실측이다.

```cmake title="CMakeLists.txt — Google Benchmark를 FetchContent로"
cmake_minimum_required(VERSION 3.16)
project(bench_demo CXX)

include(FetchContent)
set(BENCHMARK_ENABLE_TESTING OFF)        # benchmark 자신의 테스트는 안 받는다
set(BENCHMARK_ENABLE_GTEST_TESTS OFF)    # GoogleTest 의존성도 끊는다
FetchContent_Declare(
  benchmark
  GIT_REPOSITORY https://github.com/google/benchmark.git
  GIT_TAG        v1.9.4
)
FetchContent_MakeAvailable(benchmark)

add_executable(bench bench.cpp)
target_link_libraries(bench PRIVATE benchmark::benchmark_main)
target_compile_features(bench PRIVATE cxx_std_20)
```

`set()` 두 줄이 중요하다. 이 옵션들을 끄지 않으면 Google Benchmark가 자기 자신의 단위 테스트를 빌드하려고 GoogleTest까지 끌고 들어온다 — 우리는 라이브러리만 쓰면 되므로 둘 다 끈다. 구성·빌드는 이렇게 걸렸다: `cmake .. -DCMAKE_BUILD_TYPE=Release` 구성에 8.4초(이때 실제 clone이 일어난다, 저장소 5.6MB), 4스레드 병렬 빌드에 13.8초(cmake 3.28.3 실측). `CMAKE_BUILD_TYPE=Release`로 구성한 이유는 위 `::: warn`이 이미 말했다 — 측정 대상이 `-O2`로 컴파일돼야 한다. [7.8](#/ci)에서 새니타이저 job을 `Debug`로 고정했던 것과 정확히 반대 방향의 같은 원칙이다: 빌드 타입은 그 빌드의 목적이 정한다.

::: note benchmark_main은 gtest_main과 대칭이다
`benchmark::benchmark_main`을 링크하면 `main()`을 안 써도 된다 — [7.6](#/googletest)의 `GTest::gtest_main`과 같은 패턴이다. `BENCHMARK()` 매크로로 등록된 벤치마크를 전부 실행하는 표준 `main()`이 딸려 온다. 커맨드라인 플래그(`--benchmark_filter`, `--benchmark_repetitions` 등) 파싱도 이 `main()`이 해 준다.
:::

첫 실행의 머리말부터 정보다 — 라이브러리가 실행 환경을 스스로 찍는다.

```console
$ ./bench
Run on (4 X 2800 MHz CPU s)
CPU Caches:
  L1 Data 32 KiB (x4)
  L1 Instruction 32 KiB (x4)
  L2 Unified 1024 KiB (x4)
  L3 Unified 33792 KiB (x1)
Load Average: 0.25, 0.47, 0.29
```

[8.2](#/cache)에서 `getconf`로 조회했던 캐시 계층을 벤치마크 라이브러리가 결과지 머리에 박아 준다 — 수치를 남에게 보여줄 때 "어떤 기계에서 쟀는가"가 수치의 일부라는 설계 철학이다. `Load Average`도 마찬가지다: 측정 중에 다른 부하가 있었는지를 결과와 함께 기록한다.

## BENCHMARK 매크로, 그리고 함정 1의 재현

벤치마크 하나는 `benchmark::State&`를 받는 함수 하나다. `for (auto _ : state)` 루프의 몸통이 측정 대상이고, `BENCHMARK()` 매크로가 등록한다. 함정 1이 이 프레임워크 안에서도 그대로 재현되는지부터 확인했다 — 같은 `sum()`을 결과를 버리는 버전과 `DoNotOptimize`로 감싸는 버전으로 나란히 등록했다.

```cpp title="bench.cpp — 함정 1 전후 비교"
#include <benchmark/benchmark.h>
#include <algorithm>
#include <numeric>
#include <vector>

double sum(const std::vector<double>& v) {
    double s = 0.0;
    for (double x : v) s += x;
    return s;
}

// ❌ 결과를 안 쓴다 -- 프레임워크 안에서도 컴파일러는 호출을 지운다
static void BM_Sum_Naive(benchmark::State& state) {
    std::vector<double> v(1000, 1.5);
    for (auto _ : state) {
        sum(v);
    }
}
BENCHMARK(BM_Sum_Naive);

// ✅ DoNotOptimize가 결과를 "관측된 값"으로 만든다
static void BM_Sum_DNO(benchmark::State& state) {
    std::vector<double> v(1000, 1.5);
    for (auto _ : state) {
        double s = sum(v);
        benchmark::DoNotOptimize(s);
    }
}
BENCHMARK(BM_Sum_DNO);
```

```console
$ ./bench
Benchmark                    Time             CPU   Iterations
--------------------------------------------------------------
BM_Sum_Naive             0.000 ns        0.000 ns   1000000000000
BM_Sum_DNO                1149 ns         1149 ns       607292
```

(g++ 13.3.0 / -O2 / Google Benchmark v1.9.4 실측.) `BM_Sum_Naive`는 0.000ns — 그리고 `Iterations` 열을 봐라, **1조 회**다. Google Benchmark는 반복당 시간이 0에 수렴하니까 통계를 채우려고 반복 횟수를 계속 올렸고, 1조 번을 "실행"하고도 시간이 안 나오자 0을 보고했다. 프레임워크를 쓴다고 함정 1이 저절로 사라지지 않는다는 실증이다 — 라이브러리는 도구(`DoNotOptimize`)를 줄 뿐, 그 도구를 놓는 자리는 당신이 정한다. `BM_Sum_DNO`는 1,000개 `double` 합에 1,149ns — 원소당 약 1.1ns로, `-ffast-math` 없이는 순서를 못 바꾸는 부동소수점 덧셈의 의존 사슬([8.5](#/simd)에서 자동 벡터화가 FP 합산 앞에서 멈추는 이유와 같은 제약)이 지배하는 그럴듯한 수치다.

::: deep DoNotOptimize는 마법이 아니라 인라인 어셈블리다
v1.9.4 소스(`include/benchmark/benchmark.h`)에서 GCC 경로의 구현은 한 줄이다: `asm volatile("" : "+m,r"(value) : : "memory")`. 빈 어셈블리 문장에 값을 입출력 피연산자로 묶어서, 컴파일러에게 "이 값은 여기서 읽히고 변경될 수 있다"고 선언한다 — 실제 명령은 하나도 삽입되지 않으므로 측정에 비용을 더하지 않으면서, 그 값을 만드는 계산을 지울 수 없게 만든다. 짝꿍인 `benchmark::ClobberMemory()`는 `asm volatile("" : : : "memory")` — "메모리 전체가 읽혔을 수 있다"는 선언으로, 결과가 값이 아니라 **메모리에 쓴 내용**일 때 그 쓰기가 지워지는 걸 막는다. 예를 들어 버퍼를 채우는 벤치마크는 `DoNotOptimize(v.data())`로 포인터를 관측시키고 `ClobberMemory()`로 마무리한다 — 이 패턴으로 1,024개 `int` `std::fill`을 재니 43.2ns(1,600만 회 반복, 실측)가 나왔다.
:::

## 함정 2: 워밍업 — 첫 실행은 다른 것을 잰다

두 번째 함정은 프레임워크 없이 재현하는 게 더 선명하다. 8MB 벡터를 새로 할당해 채우고 합산하는 작업을 한 프로세스 안에서 다섯 번 반복하며 각각 쟀다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 coldwarm.cpp -o coldwarm && ./coldwarm
run 1:   4687 us (s=1500000)
run 2:   3719 us (s=1500000)
run 3:   1664 us (s=1500000)
run 4:   1502 us (s=1500000)
run 5:   1527 us (s=1500000)
```

(실측. 두 번째 실행에서도 같은 패턴이었다: 3239/3256/1586/1543/1519µs.) 같은 코드, 같은 데이터 크기인데 1회차가 5회차보다 **3.1배** 느리다. 1~2회차에는 커널에서 새 페이지를 받아 처음 만지는 비용(페이지 폴트)이 섞여 있고, 3회차부터는 할당자가 이미 매핑된 메모리를 재사용해서 그 비용이 사라진다 — 캐시와 분기 예측기가 데워지는 효과도 같은 방향으로 겹친다. 첫 실행 하나만 재면 "이 함수는 4.7ms짜리"라고 결론 내리게 되는데, 정상 상태(steady state)의 진실은 1.5ms다. 어느 쪽이 "맞는" 수치인가는 질문에 달렸다 — 이 함수가 프로그램에서 단 한 번 호출된다면 콜드 수치가 진실이고, 제어 루프에서 초당 수백 번 불린다면 웜 수치가 진실이다. **중요한 건 두 수치가 다르다는 사실을 모른 채 아무거나 하나 재는 것이다.**

Google Benchmark는 이 문제를 반복 횟수 자동 조정으로 처리한다. 위 출력의 `Iterations` 열이 그 증거다 — `BM_Sum_DNO`는 607,292회, 43ns짜리 `BM_Fill`은 16,251,261회, 뒤에 나올 5.7ms짜리 순회는 116회. 벤치마크마다 "통계적으로 의미 있는 총 시간(기본 최소 실행 시간)이 채워질 때까지" 반복 횟수를 스스로 늘리므로, 첫 몇 회의 콜드 비용은 수십만 회 평균 속에 희석된다. 콜드 효과가 큰 벤치마크라면 `--benchmark_min_warmup_time=<초>`로 측정에서 제외되는 예열 구간을 명시적으로 둘 수도 있다(v1.9.4 `--help`에서 확인).

## 함정 3: 분산 — 한 번 잰 수치는 수치가 아니다

같은 벤치마크를 `--benchmark_repetitions=10`으로 돌리면 전체 측정을 10번 반복하고 통계를 낸다.

```console
$ ./bench --benchmark_filter=BM_Sum_DNO --benchmark_repetitions=10
BM_Sum_DNO              1149 ns         1149 ns       610878
BM_Sum_DNO              1152 ns         1151 ns       610878
...                     (10회 반복: 1149~1158ns)
BM_Sum_DNO_mean         1152 ns         1152 ns           10
BM_Sum_DNO_median       1151 ns         1151 ns           10
BM_Sum_DNO_stddev       2.78 ns         2.77 ns           10
BM_Sum_DNO_cv           0.24 %          0.24 %            10
```

(실측.) L1에 상주하는 계산 위주 벤치마크는 변동 계수(cv, 표준편차/평균) 0.24% — 아주 안정적이다. 그런데 같은 방식으로 64MB(캐시 밖, 메모리 대역폭이 지배)를 순회하는 벤치마크를 돌리면 cv가 **4.58%**로 뛴다(mean 5.98ms, median 6.02ms, stddev 274µs, 실측). 메모리 대역폭은 코어 넷이 공유하는 자원이라, 같은 기계의 다른 프로세스가 내는 트래픽이 내 수치에 그대로 섞이기 때문이다.

프로세스를 통째로 다시 띄우면 편차는 더 커진다. 그 64MB 순회 벤치마크가 든 바이너리를 8번 따로 실행해서 같은 항목을 모았다: 5.66, 6.40, 7.00, 7.28, 7.29, 7.33, 7.37, 7.41ms — **최솟값과 최댓값이 31% 차이 난다. 코드는 한 글자도 안 바뀌었는데.** 이 책의 실측 환경은 컨테이너, 즉 다른 작업과 하드웨어를 공유하는 환경이라 편차가 개인 PC보다 큰 편이고, 그 사실 자체가 이 절의 교재다 — 당신이 CI 러너나 클라우드 VM에서 벤치마크를 돌리면 정확히 이런 수치를 보게 된다.

그래서 벤치마크 결과는 평균 하나로 읽지 않는다. **간섭 노이즈는 한쪽 방향으로만 작용한다** — 다른 프로세스가 내 코드를 더 빠르게 만들어 주는 일은 없고, 느리게 만드는 일만 있다. 따라서 반복 측정에서 최솟값은 "코드 자체의 비용"에 가장 가까운 추정치고, 중앙값은 이상치 몇 개에 오염되지 않는 대표값이며, 평균은 꼬리쪽 이상치에 끌려 올라간 값이다. 위 실측에서도 mean(5.98ms)이 개별 값들의 아래쪽 무리보다 위에 있다. 알고리즘 A와 B를 비교할 때는 각자의 중앙값(또는 최솟값)끼리 비교하라 — 단, 뒤에 나올 실시간 이야기에서는 이 규칙이 정반대로 뒤집힌다.

::: tip iterations와 repetitions는 다른 축이다
`Iterations`(한 측정 안에서 루프 몸통을 돈 횟수)는 라이브러리가 자동으로 정하고, `--benchmark_repetitions`(그 측정 전체를 몇 번 반복해 통계를 낼 것인가)는 당신이 정한다. 위 출력에서 10회 반복의 `Iterations`가 전부 610,878로 같은 이유다 — 반복 횟수 산정은 첫 회에 한 번 하고 재사용한다. 수치를 어딘가에 기록해 남길 벤치마크라면 `--benchmark_repetitions=10` 이상을 습관으로 삼아라. 단 한 번 잰 수치는 위 8회 실측이 보여줬듯 ±31% 구간의 어느 점인지 알 수 없는 값이다.
:::

## 입력 크기 스윕: state.range와 캐시 절벽

`BENCHMARK(...)->Range(a, b)`는 같은 벤치마크를 여러 입력 크기로 자동 반복하고, 함수 안에서는 `state.range(0)`으로 그 크기를 받는다. [8.2](#/cache)의 캐시 계층이 Big-O 분석에 안 잡히는 성능 절벽을 만든다는 걸, 이 도구로 한 번에 재현할 수 있다 — `int64_t` 벡터 순회를 8KB부터 64MB까지 스윕했다.

```cpp title="bench.cpp — 크기 스윕과 커스텀 카운터"
static void BM_Traverse(benchmark::State& state) {
    const std::size_t n = static_cast<std::size_t>(state.range(0));
    std::vector<std::int64_t> v(n, 1);
    for (auto _ : state) {
        std::int64_t s = 0;
        for (std::int64_t x : v) s += x;
        benchmark::DoNotOptimize(s);
    }
    state.SetBytesProcessed(
        static_cast<std::int64_t>(state.iterations()) * n * sizeof(std::int64_t));
    state.counters["ns/elem"] = benchmark::Counter(
        static_cast<double>(state.iterations()) * n,
        benchmark::Counter::kIsRate | benchmark::Counter::kInvert);
}
BENCHMARK(BM_Traverse)->RangeMultiplier(8)->Range(1 << 10, 1 << 23);
```

```console
$ ./bench --benchmark_min_time=0.5s
BM_Traverse/1024           237 ns    ...  bytes_per_second=32.2235Gi/s ns/elem=231.216ps
BM_Traverse/4096           934 ns    ...  bytes_per_second=32.6581Gi/s ns/elem=228.139ps
BM_Traverse/32768         7665 ns    ...  bytes_per_second=31.8605Gi/s ns/elem=233.85ps
BM_Traverse/262144       67152 ns    ...  bytes_per_second=29.096Gi/s  ns/elem=256.069ps
BM_Traverse/2097152     632260 ns    ...  bytes_per_second=24.715Gi/s  ns/elem=301.46ps
BM_Traverse/8388608    5661089 ns    ...  bytes_per_second=11.0404Gi/s ns/elem=674.845ps
```

(실측. 원소 수 1,024~8,388,608은 데이터 크기 8KB~64MB에 해당한다.) 알고리즘은 전 구간에서 똑같은 $O(n)$ 선형 순회다 — Big-O만 보면 원소당 시간은 상수여야 한다. 실측은 다르게 말한다. 8KB~256KB(L1~L2 안)에서는 원소당 0.23ns로 평평하다가, 2MB(코어당 L2 1MB 초과)에서 0.26ns, 16MB(L3 안)에서 0.30ns, 64MB(L3 33MB 초과, RAM행)에서 **0.67ns로 2.9배** 뛴다. 대역폭으로 읽으면 32GiB/s에서 11GiB/s로 꺾인다. [8.2](#/cache)가 이론으로, [8.4](#/data-oriented)가 레이아웃 설계로 다룬 그 계층이 벤치마크 결과표에 계단으로 찍힌 것이다 — 그리고 결과지 머리말의 `CPU Caches` 블록과 이 계단의 위치가 정확히 대응한다.

`SetBytesProcessed()`가 `bytes_per_second` 열을, `benchmark::Counter`가 임의의 커스텀 열을 만든다. `kIsRate`는 "총량을 경과 시간으로 나눠 초당 비율로 표시"하라는 뜻이고 `kInvert`는 그 역수 — 그래서 `ns/elem`(원소당 시간) 열이 나온다. 시간 하나만 찍힌 표보다 "이 코드가 하드웨어 한계(메모리 대역폭) 대비 어디까지 왔는가"를 바로 읽을 수 있는 표가 낫다.

::: perf 이 절벽이 벤치마크 설계에 주는 교훈
입력 크기 하나로 잰 벤치마크는 그 크기의 캐시 상황 하나만 대변한다. 위 실측에서 4,096 원소로만 쟀다면 "원소당 0.23ns"가 결론이었겠지만, 실전 데이터가 800만 원소라면 실제 비용은 그 2.9배다. 자료구조나 알고리즘을 비교하는 벤치마크는 반드시 **실전 데이터 크기를 포함하는 스윕**으로 짜라 — `Range()` 한 줄이면 된다. (수치는 이 환경(Xeon 2.8GHz, L1d 32KB/L2 1MB/L3 33MB) 실측이고 절대값은 기계마다 다르지만, 캐시 경계에서 꺾이는 모양은 어디서나 같다.)
:::

## 벤치마크를 CI에 넣을 때: 절대값 게이트는 부러진다

[7.8](#/ci)에서 테스트·새니타이저를 커밋마다 자동으로 돌렸으니, 벤치마크도 같은 파이프라인에 넣고 "이전보다 10% 느려지면 실패"라는 게이트를 걸고 싶어진다. 이 절의 실측이 그 아이디어를 그대로 반박한다 — **같은 바이너리를 8번 돌려서 31% 편차가 나왔다.** 코드 변경이 전혀 없어도 "10% 회귀" 게이트는 수시로 울린다는 뜻이다. CI 러너는 이 환경과 같은 공유 가상 머신이고, 심지어 실행마다 다른 물리 기계에 배정될 수도 있다 — 절대 시간의 기준선 자체가 존재하지 않는다.

현실적인 절충은 이렇다. 첫째, 벤치마크 결과를 **게이트가 아니라 기록**으로 남긴다 — `--benchmark_out=result.json --benchmark_out_format=json`으로 구조화된 출력을 아티팩트로 저장하고, 추세는 사람이 그래프로 본다. 둘째, 회귀 검사가 꼭 필요하면 **같은 러너에서 기준 커밋과 후보 커밋을 연속으로 빌드·실행해 상대 비교**한다 — 두 측정이 같은 기계·같은 시간대의 노이즈를 공유하므로 절대값보다 훨씬 안정적이다. Google Benchmark 저장소의 `tools/compare.py`가 정확히 이 용도의 도구다(두 JSON 결과를 받아 벤치마크별 상대 변화율과 통계 검정 결과를 출력한다 — 받아 온 v1.9.4 소스 트리의 `tools/`에 실제로 들어 있는 걸 확인했다). 셋째, 그래도 문턱값은 널널하게 잡는다 — 이 환경 실측 기준이라면 cv 4.6%짜리 벤치마크에 10% 게이트는 무의미하고, 2배급 회귀를 잡는 조기 경보 정도가 현실적인 기대치다.

## 실시간 제어 루프에서는 평균이 목표가 아니다

이 절의 통계(중앙값·최솟값을 보라)는 **처리량**의 언어다 — 로보틱스에는 그 규칙이 뒤집히는 자리가 있다. [6.8](#/realtime)에서 다룬 제어 루프의 마감시한이다. 헥사포드의 `ros2_control` 루프가 주기 안에 계산을 끝내야 한다면, "IK 계산이 평균 30µs"라는 문장은 아무것도 보증하지 않는다 — 1,000번 중 999번이 30µs고 한 번이 5ms면, 평균은 여전히 아름답지만 로봇은 그 한 번에 스텝을 놓친다. 실시간 시스템의 질문은 "보통 얼마나 걸리는가"가 아니라 **"최악에 얼마나 걸리는가"**고, 따라서 봐야 할 통계는 mean·median이 아니라 max와 높은 백분위(p99, p99.9)다.

여기서 Google Benchmark의 한계를 정직하게 알아야 한다. 결과표의 `Time` 열은 **반복 수십만 회의 평균**이다 — 반복 한 회가 튀어도 평균 속에 묻힌다. `--benchmark_repetitions`에 `ComputeStatistics`를 얹으면 max 행을 추가할 수 있고(이 환경에서 `BM_Sum_DNO`에 걸어 10회 반복을 돌리니 `_max` 1164ns, median 1152ns가 나왔다 — 실측), 그조차 "반복 평균들 중의 최댓값"이지 단일 실행의 최악 지연이 아니다. 마이크로벤치마크는 **후보 알고리즘들을 비교해 고르는 도구**로 쓰고, 마감시한의 증명은 [6.8](#/realtime)의 방식 — 실제 제어 루프 안에서 매 주기의 소요 시간을 직접 기록해 max/백분위 히스토그램을 뽑는 계측 — 으로 따로 해야 한다. 벤치마크가 "A가 B보다 중앙값에서 3배 빠르다"를 말해 주면, 실기기 계측이 "A의 p99.9가 마감시한 안에 든다"를 말해 준다. 둘은 대체재가 아니라 순서가 있는 두 단계다.

::: interview "최적화했더니 빨라졌다"를 어떻게 증명하나
성능 개선 경험을 말하면 거의 반드시 "측정은 어떻게 했나, 그 수치를 어떻게 신뢰하나"가 따라온다. 모범 답변 뼈대: (1) 배포와 같은 최적화 레벨로 컴파일하고, 컴파일러가 측정 대상을 제거하지 못하게 결과를 관측시켰다(`DoNotOptimize` 또는 동등한 기법 — 결과 미사용 루프가 -O2에서 0ns가 되는 사례를 들 수 있으면 강하다). (2) 워밍업 후 정상 상태를 충분한 반복으로 쟀다. (3) 반복 측정의 중앙값으로 전후를 비교했고, 편차(cv)가 개선 폭보다 충분히 작음을 확인했다. (4) 실시간 요건이 있는 코드라면 평균이 아니라 max/백분위로 따로 검증했다. 이 네 문장은 곧 이 절의 함정 1·2·3과 실시간 절의 요약이다.
:::

## Part VIII 종합: 성능 작업의 루프

이 절로 Part VIII가 완결된다. 여섯 절은 사실 하나의 작업 루프다. [8.1 프로파일링](#/profiling)이 **어디가** 느린지를 추측 대신 측정으로 찾고, [8.2 캐시](#/cache)가 그 지점이 **왜** 느린지를 메모리 계층으로 설명하고, [8.3 코드 생성](#/codegen)이 컴파일러가 이미 **무엇을 해 주고 있는지**를 어셈블리로 확인시키고, [8.4 데이터 지향 설계](#/data-oriented)가 데이터를 **어떻게 배치**해야 하드웨어와 싸우지 않는지를, [8.5 SIMD](#/simd)가 남은 하드웨어 폭을 **어떻게 다 쓰는지**를 다뤘다. 그리고 이 절이 루프를 닫는다 — 그렇게 고친 코드가 **정말 빨라졌는지를 증명**하는 방법. 증명이 끝나면 루프는 다시 8.1로 돌아간다: 다음으로 느린 곳을 프로파일러로 찾는다. 이 루프의 어느 단계도 건너뛸 수 없다는 게 Part VIII 전체의 주장이다 — 측정 없는 최적화는 방향 없는 노력이고, 검증 없는 최적화는 결론 없는 노력이다. 다음 Part부터는 이 루프를 손에 쥔 채로 로보틱스 도메인에 들어간다 — 당장 [9.1](#/eigen)의 Eigen부터가 표현식 템플릿이라는, 벤치마크 없이는 진위를 가릴 수 없는 성능 주장을 하는 라이브러리다.

## 요약

- 결과를 사용하지 않는 계산은 `-O2`에서 통째로 삭제된다 — 100만 원소 합산 100회가 119ns로 측정됐다(실측). "말이 안 되게 빠른 수치"는 빠른 코드가 아니라 죽은 벤치마크의 신호다.
- 결과를 써도 안전하지 않다 — 입력이 상수면 계산이 컴파일 타임으로 이동한다. 10억 회 루프가 83ns가 됐고, 어셈블리에 답이 상수로 박혀 있었다(실측). `benchmark::DoNotOptimize`/`ClobberMemory`가 이 군비 경쟁의 표준 해법이다.
- Google Benchmark는 [7.6](#/googletest)과 같은 FetchContent 패턴으로 받는다(v1.9.4, 구성 8.4초+빌드 13.8초 실측). `BENCHMARK_ENABLE_TESTING=OFF`, `BENCHMARK_ENABLE_GTEST_TESTS=OFF`를 끄고, 반드시 Release로 구성한다.
- 콜드 스타트는 정상 상태보다 3.1배 느렸다(실측) — Google Benchmark는 반복 횟수 자동 조정으로 이를 희석하고, `Iterations` 열이 그 증거다(43ns짜리는 1,600만 회, 5.7ms짜리는 116회).
- 단일 측정은 신뢰 구간이 없는 점 하나다 — 같은 바이너리 8회 실행에서 31% 편차가 났다(컨테이너 환경 실측). `--benchmark_repetitions`로 통계를 내고, 처리량 비교는 중앙값·최솟값으로 한다(간섭 노이즈는 느려지는 방향으로만 작용한다).
- `state.range()` 스윕으로 같은 $O(n)$ 순회가 캐시 경계에서 원소당 0.23ns→0.67ns로 꺾이는 것을 한 표로 잡았다 — Big-O에 없는 구간은 [8.2](#/cache)의 계층이 만든다.
- CI에서 절대값 회귀 게이트는 러너 편차 때문에 부러진다 — 결과는 JSON 아티팩트로 기록하고, 회귀 검사는 같은 러너에서의 연속 A/B 상대 비교(`tools/compare.py`)로 한다.
- 실시간 제어 루프의 기준은 평균이 아니라 최악 지연이다 — 마이크로벤치마크는 알고리즘 선택 도구고, 마감시한 증명은 [6.8](#/realtime)의 실기기 계측(max/백분위)이 따로 한다.

::: quiz 연습문제
1. 이 절의 첫 실측에서 `-O2` 벤치마크가 호출당 1.2ns를 보고했다. 이 수치가 물리적으로 불가능하다고 판정한 근거와, 실제로 무슨 일이 일어난 것인지 설명하라.
2. (예측) `BM_Sum_DNO`에서 `benchmark::DoNotOptimize(s)` 한 줄만 지우고 다시 빌드해 돌리면 결과표의 Time과 Iterations가 각각 어떻게 변할지, 이 절의 `BM_Sum_Naive` 실측을 근거로 예측하라.
3. (판단) 동료가 "CI에 벤치마크를 넣고 이전 커밋보다 5% 느려지면 빌드를 실패시키자"고 제안했다. 이 절의 실측(같은 바이너리 8회 실행) 수치를 들어 이 제안의 문제를 지적하고, 대안을 두 가지 제시하라.
4. 헥사포드 제어 루프에 들어갈 IK 함수 후보 A(중앙값 40µs, 최대 45µs)와 B(중앙값 25µs, 가끔 2ms 스파이크)가 있다. [6.8](#/realtime)의 마감시한 관점에서 어느 쪽을 고르고, 그 판단에 벤치마크의 어떤 통계가 필요한지 답하라.
5. (실습, 코드 작성형) 이 절의 CMakeLists.txt와 bench.cpp를 네 IDE에서 직접 타이핑해 구성하라. 그다음 `std::vector<int>`에서 원소를 찾는 `std::find` 벤치마크를 새로 추가하되, `state.range(0)`으로 크기를 1<<10부터 1<<20까지 스윕하고 찾는 값은 항상 마지막 원소로 두라(최악 케이스). `DoNotOptimize` 없이 한 번, 있고 한 번 돌려서 — 없는 쪽이 0에 수렴하는지 확인하는 것까지가 과제다. 기준 명령: `cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --parallel && ./build/bench`.
:::

::: answer 해설
1. 100만 개 `double` 덧셈이 1.2ns에 끝나려면 덧셈 하나가 0.0000012ns여야 하는데, 이 CPU(2.8GHz)의 한 사이클이 0.36ns다 — 다섯 자릿수 차이로 불가능하다. 실제로는 결과가 사용되지 않는 순수 함수 호출을 컴파일러가 죽은 코드로 증명하고 루프째 삭제했고, 남은 1.2ns는 시계를 두 번 읽는 비용을 100으로 나눈 것이다. `-O0` 실측(호출당 8.0ms)과의 대비가 "루프가 실행되지 않았다"는 판정을 확정한다.
2. `BM_Sum_Naive`와 같은 코드가 되므로 같은 결과가 나와야 한다 — Time은 0.000ns로 떨어지고, Iterations는 라이브러리가 최소 실행 시간을 채우려고 반복을 계속 올리다 상한에 닿아 1조 회 같은 비정상적 수치로 치솟는다. "Iterations가 폭발하고 Time이 0에 수렴"하는 조합 자체를 죽은 벤치마크의 시그니처로 기억해 두면 된다.
3. 이 절에서 코드를 한 글자도 안 바꾸고 같은 바이너리를 8번 돌렸을 때 최솟값 5.66ms, 최댓값 7.41ms — 31% 편차가 났다. 5% 문턱은 이 노이즈 폭 안에 완전히 잠기므로, 게이트는 실제 회귀와 무관하게 수시로 울리고 곧 팀 전체가 그 알람을 무시하게 된다(늑대와 양치기). 대안: (1) 결과를 `--benchmark_out` JSON 아티팩트로 기록만 하고 추세를 사람이 검토한다. (2) 회귀 검사가 필요하면 같은 러너에서 기준 커밋과 후보 커밋을 연속 실행해 `tools/compare.py`로 상대 비교하고, 문턱도 노이즈(cv)보다 충분히 크게 잡는다.
4. A를 고른다. 제어 루프의 제약은 "매 주기 마감시한 안에 끝난다"이고, B의 2ms 스파이크는 중앙값이 아무리 좋아도 그 주기의 마감을 깨뜨린다 — 평균/중앙값은 처리량의 언어지 마감시한의 언어가 아니다. 필요한 통계는 max와 높은 백분위(p99, p99.9)이며, Google Benchmark의 기본 Time 열(반복 평균)로는 안 보이므로 실제 루프 주기별 소요 시간을 직접 기록하는 히스토그램 계측이 필요하다.
5. `DoNotOptimize` 없는 버전은 `std::find`의 반환값(반복자)이 사용되지 않아 호출이 제거되고, Time이 0 근처로 떨어지며 Iterations가 폭발해야 한다 — 2번 문제와 같은 시그니처다. `DoNotOptimize(it)`를 넣은 버전은 크기에 비례해 시간이 늘고, 스윕 구간이 캐시 경계를 넘으면(이 절의 순회 실측처럼) 원소당 시간이 평평하다 꺾이는 것까지 관찰되면 성공이다. 두 버전의 결과표를 나란히 놓고 차이를 설명할 수 있어야 한다.
:::

이 절의 모든 실측은 네 환경에서 그대로 재현할 수 있다 — 직접 타이핑해서 확인하라. 순서대로: `g++ -std=c++20 -Wall -Wextra -O2 naive.cpp -o naive && ./naive`로 함정 1을 먼저 재현하고(-O0과 비교), `cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --parallel && ./build/bench`로 Google Benchmark 스위트를 돌린 뒤, `./build/bench --benchmark_repetitions=10`으로 네 기계의 cv가 얼마나 나오는지 확인하라 — 절대값은 다르겠지만, 죽은 벤치마크의 0ns와 캐시 절벽의 꺾임은 어디서나 같다.

**다음 절**: [9.1 Eigen: 선형대수를 C++로](#/eigen) — 언어와 도구가 갖춰졌으니 로보틱스 도메인으로 들어간다. 첫 상대는 표현식 템플릿으로 "공짜 추상화"를 주장하는 선형대수 라이브러리다 — 이 절에서 만든 벤치마크가 그 주장을 검증할 도구다.

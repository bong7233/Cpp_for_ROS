# 2.12 객체 메모리 레이아웃과 정렬

::: lead
[1.8](#/structs-enums)에서 이미 이상한 것을 봤다 — `char`(1) + `double`(8) + `int`(4)는 13바이트인데 `sizeof`는 24가 나왔고, 멤버 순서만 바꿨더니 16이 됐다. 그 절은 "이런 현상이 있다"까지만 말하고 멈췄다. 이 절은 **왜 컴파일러가 멤버 사이에 빈 공간을 끼워 넣는가**에 답한다. 답은 정렬(alignment) — 타입마다 정해진 주소 배수 요구다. 정렬 요구가 어디서 오는지, 패딩이 정확히 몇 바이트 붙는지 계산하는 규칙, 멤버 순서로 패딩을 줄이는 법, `alignas`로 정렬을 강제하는 법, `offsetof`로 실제 바이트 위치를 확인하는 법, 그리고 패킹된 구조체로 패딩을 강제로 없애는 법을 전부 실측으로 확인한다. Part II 마지막 절이고, [2.11](#/ub-sanitizers)에서 본 "정의되지 않은 동작"의 목록에 정렬 위반도 정확히 들어간다.
:::

## 정렬 요구사항: 왜 타입마다 배수가 정해져 있나

[1.4](#/casting)에서 이미 정렬 위반 하나를 실측했다 — 4바이트 정렬을 요구하는 `float`를 홀수 주소에서 읽으면 UBSan이 `load of misaligned address ... which requires 4 byte alignment`라고 잡아냈다. 그 절은 "정렬 위반이 UB"라는 사실과 x86이 눈감아 준다는 사실까지만 다뤘다. 여기서는 그 요구가 어디서 오는지 파고든다.

`alignof` 연산자는 타입이 요구하는 주소 배수를 알려 준다. x86-64 Linux, g++ 13.3 실측이다.

```cpp title="alignof.cpp — 기본 타입의 정렬 요구"
#include <cstdio>
#include <cstddef>

int main() {
    std::printf("alignof(char)        = %zu\n", alignof(char));
    std::printf("alignof(short)       = %zu\n", alignof(short));
    std::printf("alignof(int)         = %zu\n", alignof(int));
    std::printf("alignof(long)        = %zu\n", alignof(long));
    std::printf("alignof(float)       = %zu\n", alignof(float));
    std::printf("alignof(double)      = %zu\n", alignof(double));
    std::printf("alignof(long double) = %zu\n", alignof(long double));
    std::printf("alignof(void*)       = %zu\n", alignof(void*));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra alignof.cpp -o alignof
$ ./alignof
alignof(char)        = 1
alignof(short)       = 2
alignof(int)         = 4
alignof(long)        = 8
alignof(float)       = 4
alignof(double)      = 8
alignof(long double) = 16
alignof(void*)       = 8
```

패턴이 보인다. **정렬 요구는 거의 항상 타입의 크기와 같다.** `int`는 4바이트이자 4바이트 정렬, `double`은 8바이트이자 8바이트 정렬이다. 우연이 아니다 — CPU가 메모리를 읽는 단위와 관련이 있다.

메모리 버스와 캐시는 임의의 1바이트를 낱개로 나르지 않는다. 최소 전송 단위(이 환경에서는 캐시 라인 64바이트)로 묶어서 나른다. `int` 하나가 정확히 4의 배수 주소에 있으면, CPU는 그 4바이트가 항상 하나의 정렬된 단위 안에 통째로 들어 있다는 것을 보장받는다 — 한 번의 로드 명령으로 끝난다. 반대로 4바이트 정수가 예를 들어 주소 3에서 시작하면, 3~6번 바이트는 한 정렬 단위(0~3)와 다음 정렬 단위(4~7)에 걸쳐 있다. 하드웨어는 이 경우 두 단위를 각각 읽어 필요한 바이트를 잘라 붙이는 추가 작업을 해야 한다 — 명령어 하나가 아니라 로드 두 번과 병합이 될 수 있다.

x86-64는 이 병합을 하드웨어가 대신 해 준다. 그래서 정렬 위반이 `float`처럼 크래시로 이어지지 않는다(1.4의 UBSan 실측이 이를 확인했다 — 표준은 UB라고 규정하지만 이 CPU는 계속 실행한다). ARM 계열의 일부 명령은 이 관용을 베풀지 않고 정렬 위반 시 버스 폴트를 낸다 — 개발 PC에서 멀쩡하던 코드가 ARM 보드에서 죽는 사고의 전형적인 원인이고, [1.2](#/types)의 char 부호 문제와 같은 계열의 이식성 함정이다.

::: perf 이 환경에서 실측한 정렬 위반의 실제 비용
캐시 라인 안에서 벗어나지 않는 단일 `double` 로드/스토어를 2억 번 반복해 정렬된 주소(8의 배수)와 그렇지 않은 주소(정렬 안 됨)를 비교했다: `aligned = 247.58ms`, `misaligned = 244.98ms`, 비율 `0.989` — 사실상 차이가 없다. 64바이트 캐시 라인 경계를 걸치는 위치(오프셋 60, 8바이트 중 4바이트가 다음 라인으로 넘어감)로도 다시 재 봤다: `aligned(line start) = 248.24ms`, `line-crossing = 247.89ms`, 비율 `0.999` — 여전히 차이가 없다. 이 CPU의 로드/스토어 유닛이 L1 상주 데이터에 대해 정렬 위반과 라인 경계 걸침을 사실상 공짜로 처리한다는 뜻이다. 페이지 경계를 걸치는 접근이나 SIMD 명령의 정렬 요구(align 8.5의 주제)는 이 실측 범위 밖이라 이 환경에서 별도로 재지 않았다 — 그 경우들은 실제로 더 비싸다고 문서화돼 있지만, 이 절에서 단정하지는 않는다.
:::

::: note 정렬은 "느려짐"이 전부가 아니다
x86이 정렬 위반을 눈감아 준다고 해서 정렬 요구가 장식은 아니다. 컴파일러는 타입의 정렬이 항상 지켜진다는 가정 위에서 최적화한다 — 예를 들어 자동 벡터화가 정렬된 SIMD 로드 명령을 고르는 것도, 원자적 연산이 원자성을 보장하는 것도 정렬 전제 위에 서 있다. `alignof`가 보장하는 배수를 어기면(예: `reinterpret_cast`로 임의 주소를 특정 타입 포인터로 캐스팅) 표준상 UB이고, 최적화 빌드에서만 터지는 버그의 후보가 된다.
:::

## 패딩이 생기는 정확한 규칙

정렬 요구를 알면 패딩의 규칙은 두 줄로 끝난다.

1. **각 멤버는 자신의 `alignof` 배수인 오프셋에 와야 한다.** 앞 멤버가 그 자리를 못 채우면 컴파일러가 빈 바이트(패딩)를 채워 넣는다.
2. **구조체 전체의 `sizeof`는 구조체의 `alignof`(멤버 중 가장 큰 `alignof`)의 배수로 올림된다.** 배열로 만들었을 때 두 번째 원소도 똑같이 정렬되게 하려면, 한 원소의 끝에서 다음 원소의 시작까지도 정렬 배수여야 하기 때문이다 — 이 끝자리 패딩을 꼬리 패딩(tail padding)이라 부른다.

[1.8](#/structs-enums)의 `Bad`/`Good`을 이 두 규칙으로 손으로 계산해 본다.

`Bad`는 `char id; double position; int error_code;` 순서다. `id`는 오프셋 0(1바이트 정렬은 아무 데나 가능). `position`은 `double`이라 8의 배수 오프셋이 필요한데 `id` 다음은 오프셋 1이므로 7바이트를 패딩으로 채우고 오프셋 8에 놓는다. `position`이 8바이트를 쓰니 다음은 오프셋 16, `error_code`는 `int`라 4의 배수면 되므로 그대로 오프셋 16에 놓고 4바이트를 쓴다 — 여기까지 20바이트. 구조체의 `alignof`는 멤버 중 가장 큰 것, `double`의 8이므로 전체 크기는 8의 배수로 올림돼 24가 된다. 20 → 24, 꼬리 패딩 4바이트.

`Good`은 `double position; int error_code; char id;` 순서다. `position`은 오프셋 0(이미 8의 배수), `error_code`는 오프셋 8(4의 배수, 문제 없음), `id`는 오프셋 12 — 여기까지 13바이트. `alignof`는 여전히 8이므로 13은 16으로 올림된다. 손으로 계산한 24와 16이 [1.8](#/structs-enums)에서 이미 실측한 `sizeof(Bad) = 24`, `sizeof(Good) = 16`과 정확히 일치한다. 계산과 실측이 일치한다는 것을 `offsetof`로 한 번 더 확인한다 — 매크로 자체는 뒤에서 다룬다.

```console
$ ./offsets
sizeof(Bad)  = 24, alignof(Bad)  = 8
  offsetof id          = 0
  offsetof position    = 8
  offsetof error_code  = 16
sizeof(Good) = 16, alignof(Good) = 8
  offsetof position    = 0
  offsetof error_code  = 8
  offsetof id          = 12
```

계산했던 오프셋(0, 8, 16)과 (0, 8, 12)이 그대로 나왔다. 패딩은 미스터리가 아니라 이 두 규칙을 기계적으로 적용한 결과다.

## 멤버 순서와 캐시 라인 — 로봇 상태 배열의 실제 비용

`Bad`와 `Good`은 정보량이 같은데 크기가 다르다. 이 차이는 구조체 하나로는 안 보이고 **배열**로 만드는 순간 실전 비용이 된다. 헥사포드는 관절이 18개다. `Bad` 배치로 관절 상태 배열을 만들면 24 × 18 = 432바이트, `Good` 배치면 16 × 18 = 288바이트 — 같은 정보에 1.5배 차이다. 캐시 라인(이 CPU에서 64바이트)으로 나누면 `Bad`는 432 / 64 = 6.75, 즉 7개 라인을 건드리고 `Good`은 288 / 64 = 4.5, 즉 5개 라인으로 끝난다. 관절 18개짜리 배열 하나를 순회하는 데 캐시 라인 두 개를 더 끌어와야 한다는 뜻이다.

18개는 체감이 안 될 만큼 작다. 배열을 200만 개로 늘려 같은 배치의 구조체를 순회하며 `position` 필드만 합산하는 벤치마크를 실측했다(`-O2`, 50회 반복 평균).

```cpp title="cachebench.cpp — 순서만 다른 두 구조체, 같은 순회"
#include <chrono>
#include <cstdio>
#include <vector>

struct Bad  { char id; double position; int error_code; };   // 24바이트
struct Good { double position; int error_code; char id; };   // 16바이트

template <typename T>
double bench(int n, int reps) {
    std::vector<T> v(n);
    for (auto& e : v) e.position = 1.0;
    volatile double sink = 0;
    auto t0 = std::chrono::steady_clock::now();
    for (int r = 0; r < reps; ++r) {
        double sum = 0;
        for (auto& e : v) sum += e.position;
        sink = sum;
    }
    auto t1 = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(t1 - t0).count();
}

int main() {
    int n = 2'000'000, reps = 50;
    std::printf("sizeof(Bad)=%zu sizeof(Good)=%zu n=%d reps=%d\n", sizeof(Bad), sizeof(Good), n, reps);
    double tb = bench<Bad>(n, reps);
    double tg = bench<Good>(n, reps);
    std::printf("Bad  total = %.2f ms\n", tb);
    std::printf("Good total = %.2f ms\n", tg);
    std::printf("ratio Bad/Good = %.3f\n", tb / tg);
    return 0;
}
```

```console
$ g++ -std=c++20 -O2 -Wall -Wextra cachebench.cpp -o cachebench
$ ./cachebench
sizeof(Bad)=24 sizeof(Good)=16 n=2000000 reps=50
Bad  total = 210.28 ms
Good total = 153.89 ms
ratio Bad/Good = 1.366
```

세 번 반복해도 비율은 1.35~1.42배 사이였다 — 바이트 비율(24/16 = 1.5)과 같은 자릿수다. 멤버 순서를 바꾸는 것만으로, 로직은 한 글자도 안 건드리고 같은 배열을 순회하는 데 걸리는 시간이 3분의 1 넘게 줄었다. 왜 캐시 미스가 이런 비용을 만드는지, AoS(Array of Structs)와 SoA(Struct of Arrays)의 선택은 [8.2 캐시와 메모리 레이아웃](#/cache)과 [8.4 데이터 지향 설계](#/data-oriented)에서 정면으로 다룬다. 여기서 가져갈 실전 규칙은 하나다 — **구조체 멤버는 큰 것부터 작은 것 순서로 선언하라.** 컴파일러가 패딩을 최소화해 주고, 그 구조체를 배열로 늘어놓는 순간 캐시 라인 수 차이가 실행 시간 차이로 그대로 나타난다.

## alignas로 정렬을 강제한다

지금까지는 컴파일러가 정하는 정렬을 따라갔다. `alignas`는 반대로 **더 엄격한 정렬을 요구**한다 — 대표적으로 캐시 라인 경계에 변수를 강제로 붙이는 용도다.

```cpp title="alignas1.cpp — 캐시 라인에 강제로 맞추기"
#include <cstdint>
#include <cstdio>

struct Counter        { long value = 0; };
struct alignas(64) PaddedCounter { long value = 0; };

int main() {
    std::printf("sizeof(Counter)       = %zu, alignof = %zu\n", sizeof(Counter), alignof(Counter));
    std::printf("sizeof(PaddedCounter) = %zu, alignof = %zu\n", sizeof(PaddedCounter), alignof(PaddedCounter));

    Counter arr[2];
    PaddedCounter parr[2];
    auto addr = [](void* p) { return reinterpret_cast<std::uintptr_t>(p); };
    std::printf("Counter arr[1]-arr[0]       diff = %ld\n", (long)(addr(&arr[1]) - addr(&arr[0])));
    std::printf("PaddedCounter arr[1]-arr[0] diff = %ld\n", (long)(addr(&parr[1]) - addr(&parr[0])));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra alignas1.cpp -o alignas1
$ ./alignas1
sizeof(Counter)       = 8, alignof = 8
sizeof(PaddedCounter) = 64, alignof = 64
Counter arr[1]-arr[0]       diff = 8
PaddedCounter arr[1]-arr[0] diff = 64
```

`long` 하나만 담는 구조체가 `alignas(64)` 한 줄로 8바이트에서 64바이트로 부풀었다. 낭비처럼 보이지만 목적이 있다 — **서로 다른 스레드가 각자 갱신하는 카운터가 같은 캐시 라인에 있으면, 실제로는 서로 다른 변수를 건드리는데도 캐시 일관성 프로토콜 때문에 캐시 라인 전체가 스레드 사이를 핑퐁한다.** false sharing이라 부르는 이 현상은 [6.5 atomic과 메모리 오더](#/atomic)에서 여러 스레드가 갱신하는 원자 변수에, [8.2 캐시와 메모리 레이아웃](#/cache)에서 그 비용을 실측치와 함께 정면으로 다룬다. 여기서는 도구만 챙긴다 — **동시에 갱신되는 변수를 서로 다른 캐시 라인에 떨어뜨리고 싶으면 `alignas(64)`를 붙인다.**

## offsetof로 확인하고, 패킹으로 지운다

지금까지 오프셋은 계산과 `printf` 출력으로 확인했다. 표준이 제공하는 정식 도구는 `<cstddef>`의 `offsetof` 매크로다 — 멤버가 구조체 시작에서 몇 바이트 떨어져 있는지 컴파일 타임 상수로 돌려준다.

```cpp title="조각: offsetof 사용법"
#include <cstddef>
struct Good { double position; int error_code; char id; };
static_assert(offsetof(Good, position) == 0);
static_assert(offsetof(Good, error_code) == 8);
static_assert(offsetof(Good, id) == 12);
```

패딩은 지금까지 "컴파일러가 알아서 넣는 것"이었다. 통신 프로토콜처럼 **바이트 배치 자체가 계약**인 자리에서는 패딩이 계약 위반이 된다. IMU가 UART로 상태 바이트, 타임스탬프, 시퀀스 번호를 실어 보내는 패킷을 예로 든다.

```cpp title="imu_packet.cpp — 패딩이 있는 버전과 없는 버전"
#include <cstdint>
#include <cstddef>
#include <cstdio>

struct ImuPacket {                              // 일반 구조체 -- 패딩이 낀다
    std::uint8_t  status;
    double        timestamp_s;
    std::uint32_t seq;
};

struct [[gnu::packed]] ImuPacketWire {          // 패딩을 강제로 없앤 버전
    std::uint8_t  status;
    double        timestamp_s;
    std::uint32_t seq;
};

int main() {
    std::printf("sizeof(ImuPacket)     = %zu, alignof = %zu\n", sizeof(ImuPacket), alignof(ImuPacket));
    std::printf("sizeof(ImuPacketWire) = %zu, alignof = %zu\n", sizeof(ImuPacketWire), alignof(ImuPacketWire));
    std::printf("  offsetof timestamp_s (일반) = %zu\n", offsetof(ImuPacket, timestamp_s));
    std::printf("  offsetof timestamp_s (packed) = %zu\n", offsetof(ImuPacketWire, timestamp_s));
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra imu_packet.cpp -o imu_packet
$ ./imu_packet
sizeof(ImuPacket)     = 24, alignof = 8
sizeof(ImuPacketWire) = 13, alignof = 1
  offsetof timestamp_s (일반) = 8
  offsetof timestamp_s (packed) = 1
```

`[[gnu::packed]]`(GCC/Clang 확장, 표준 문법은 아니고 `#pragma pack(1)`도 같은 효과)는 각 멤버를 정렬 요구 없이 바로 이어 붙이라고 컴파일러에 지시한다. `sizeof`가 24에서 13으로, 딱 멤버 합(1+8+4)만큼 줄었다. `alignof`도 1로 떨어진다 — "이 타입은 어떤 주소에 둬도 상관없다"는 뜻이고, 뒤집으면 **정렬 보장이 사라졌다**는 뜻이다. `timestamp_s`는 이제 오프셋 1, 8의 배수가 아니다. 이 필드의 주소를 실제로 가리키면 컴파일러가 경고한다.

```cpp title="imuwarn.cpp — packed 멤버의 주소를 그대로 넘기면"
#include <cstdint>

struct [[gnu::packed]] ImuPacketWire {
    std::uint8_t  status;
    double        timestamp_s;
    std::uint32_t seq;
};

double read_ts(const double* p) { return *p; }

int main() {
    ImuPacketWire pkt{1, 12.5, 42};
    return static_cast<int>(read_ts(&pkt.timestamp_s));   // 주소를 그대로 넘긴다
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -c imuwarn.cpp
imuwarn.cpp:13:37: warning: taking address of packed member of 'ImuPacketWire' may result in an unaligned pointer value [-Waddress-of-packed-member]
```

`-Waddress-of-packed-member`가 정확히 이 절 앞부분에서 다룬 위험(정렬 안 된 포인터가 돌아다닐 수 있다)을 짚어 준다. 그럼에도 `ImuPacketWire`가 정당한 이유가 있다 — **와이어 프로토콜은 바이트 수가 계약이다.** 상대 장치(마이크로컨트롤러, 다른 프로세스)가 13바이트를 기대하는데 이쪽이 24바이트짜리를 그대로 `memcpy`해 보내면 프로토콜이 깨진다. `#pragma pack`/`[[gnu::packed]]`가 정당한 자리는 정확히 이런 직렬화 경계뿐이고, 프로그램 안에서 굴러다니는 일반 값에는 쓰지 않는다.

::: perf 패딩을 없애면 항상 느려지는가 — 실측으로는 아니다
직관은 "정렬을 어겼으니 느려질 것"이다. 200만 개짜리 배열로 `ImuPacket`과 `ImuPacketWire`를 순회하며 `timestamp_s`를 합산해 봤다: `ImuPacket = 249.51ms`, `ImuPacketWire = 150.64ms`, 비율 1.66배 — **packed 쪽이 오히려 빠르다.** 이유는 이 절 앞부분에서 실측한 두 사실이 겹쳐서다. 단일 필드의 정렬 위반 자체는 이 CPU에서 거의 공짜(비율 0.989)였고, 반면 구조체 크기 차이(24 vs 13바이트)는 캐시 라인 수 차이로 그대로 이어졌다(비율 1.366, 앞 절 실측). 정렬 위반의 공짜 비용과 패딩 제거로 줄어든 바이트 수가 같은 방향으로 작용해, 순회 성능은 크기가 작은 쪽이 이겼다. **일반화하지 마라** — 이 결과는 "정렬 위반은 항상 이득"이 아니라 "이 CPU, 이 접근 패턴(순차 스트리밍)에서는 크기가 정렬보다 더 크게 작용했다"는 뜻이다. 무작위 접근이나 SIMD 벡터화가 걸리는 코드에서는 저울이 반대로 기울 수 있다 — 실측 없이 어느 쪽도 단정하지 마라.
:::

## 요약

- [1.8](#/structs-enums)에서 본 "멤버 합보다 큰 sizeof"의 정체는 정렬(alignment) — 각 타입이 요구하는 주소 배수다. `alignof`로 실측한 기본 타입의 정렬은 거의 항상 자기 크기와 같다(`int` 4, `double` 8, `long double` 16).
- 정렬 요구는 메모리 버스·캐시가 고정폭 단위로 데이터를 나르기 때문에 생긴다. x86-64는 위반을 하드웨어가 대신 처리해 눈감아 주지만(이 환경에서 실측한 성능차는 사실상 0), ARM 계열 일부 명령은 버스 폴트를 낸다.
- 패딩 규칙은 둘뿐이다 — ① 멤버는 자기 `alignof` 배수 오프셋에 온다 ② 구조체 전체 크기는 가장 큰 멤버의 `alignof` 배수로 올림된다(꼬리 패딩). 이 규칙으로 1.8의 `Bad`(24바이트)와 `Good`(16바이트)을 손으로 계산하면 실측과 정확히 일치한다.
- 멤버를 큰 것부터 배치하면 패딩이 줄어든다. 관절 18개 배열에서 24바이트 대 16바이트는 캐시 라인 7개 대 5개 차이였고, 200만 원소 배열 순회에서는 1.35~1.42배의 실측 시간 차이로 나타났다.
- `alignas(N)`은 정렬을 강제로 올린다 — 캐시 라인(64바이트) 경계에 변수를 떨어뜨려 false sharing을 피하는 것이 대표 용도([6.5](#/atomic), [8.2](#/cache)에서 심화).
- `offsetof`는 멤버의 바이트 위치를 컴파일 타임 상수로 알려 준다. `[[gnu::packed]]`(또는 `#pragma pack`)는 패딩을 강제로 없애 정렬을 1로 낮춘다 — 통신 프로토콜처럼 바이트 수가 계약인 자리에만 쓴다. 이 환경의 실측으로는 패딩 제거가 정렬 위반 비용보다 크기 축소 이득이 커서 순회가 오히려 빨랐다(1.66배) — 결과를 일반화하지 말고 실측하라.

::: interview 구조체 패딩이 왜 생기고 멤버 순서를 어떻게 최적화하나
자주 나오는 질문이다. 답변 뼈대: ① **원인** — 각 멤버는 자신의 정렬 요구(대개 타입 크기와 같다) 배수 오프셋에 있어야 하고, 구조체 전체 크기도 가장 큰 멤버의 정렬 배수로 올림된다(꼬리 패딩). CPU가 메모리를 정렬된 고정폭 단위로 읽기 때문에 생기는 하드웨어 기원의 요구다. ② **최적화** — 멤버를 큰 타입부터 작은 타입 순으로 재배열하면 패딩이 줄어든다. `char, double, int` 순서(24바이트)를 `double, int, char` 순서(16바이트)로 바꾸는 것이 표준 예시다 — 로직 변경 없이 컴파일러 지시만으로 크기가 3분의 1 줄었다. ③ **확인 방법** — `sizeof`로 전체 크기, `offsetof`로 멤버별 정확한 바이트 위치를 확인한다. ④ **한계 사례** — 통신 프로토콜처럼 바이트 배치가 고정 계약인 곳은 `[[gnu::packed]]`/`#pragma pack(1)`로 패딩을 강제로 없앤다. 여기까지 답하고 "패딩 제거가 항상 빠른 것은 아니다, 정렬 위반 자체의 비용과 캐시 라인 수 감소 이득을 같이 봐야 하고 실측해서 판단한다"까지 말하면 상급이다.
:::

::: quiz 연습문제
1번은 계산, 2번은 개념, 3번은 실전 판단, 4번과 5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. `struct S { std::uint16_t a; std::uint64_t b; std::uint32_t c; };`의 `sizeof`를 이 절의 두 규칙으로 손으로 계산하라(정렬은 각 타입 크기와 같다고 가정). 그다음 멤버 순서를 큰 것부터(`b, c, a`)로 바꿨을 때 `sizeof`를 다시 계산하라.
2. `alignof(T)`가 `sizeof(T)`보다 작을 수 있는 경우와 클 수 있는 경우를 각각 하나씩 들어라(힌트: 배열 멤버, `alignas`).
3. 팀원이 CAN 버스로 나가는 상태 패킷 구조체 전체에 `[[gnu::packed]]`를 습관적으로 붙이자고 제안했다 — 프로그램 내부에서만 쓰이고 네트워크로 나가지 않는 구조체까지 포함해서다. 이 절의 실측을 근거로 언제는 동의하고 언제는 반대할지 말하라.
4. (실습) 1번 문제의 `S`를 두 순서로 직접 선언하고 `sizeof`를 예측한 뒤 컴파일해 확인하라. 그다음 `offsetof`로 각 멤버의 오프셋을 출력해 예측과 실측이 일치하는지 확인하라.
5. (실습) 이 절의 `ImuPacket`/`ImuPacketWire`를 그대로 타이핑하고, `-Wall -Wextra -c`로 컴파일해 `-Waddress-of-packed-member` 경고를 직접 재현하라. 그다음 두 구조체를 담은 `std::vector` 200만 개를 만들어 한 필드를 합산하는 시간을 `std::chrono`로 재고, 이 절에서 실측한 비율(1.5배 안팎)과 자신의 결과가 같은 자릿수인지 확인하라.
:::

**IDE 실습**: 이 절의 모든 코드를 직접 타이핑하고 컴파일하라. 특히 4번은 예측을 먼저 종이에 적고, 5번은 `g++ -std=c++20 -O2 -Wall -Wextra main.cpp -o main && ./main`으로 벤치마크까지 돌려서 이 절의 수치와 자신의 기기에서 나온 수치를 비교하라. 절대값은 다를 수 있어도 `Bad`가 `Good`보다 느리고 `ImuPacketWire`가 `ImuPacket`보다 빠르다는 방향은 재현돼야 한다.

**다음 절**: [3.1 클래스: 캡슐화와 불변식](#/classes) — Part II에서 값 하나하나의 메모리를 봤다면, Part III는 그 값들을 묶고 규칙을 강제하는 단위인 클래스로 간다. `public`/`private`의 진짜 목적과 멤버 초기화 리스트부터 시작한다.

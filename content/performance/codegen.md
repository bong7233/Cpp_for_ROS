# 8.3 컴파일러 최적화와 코드 생성

::: lead
같은 소스 파일이 컴파일 플래그 하나에 따라 265ms짜리 프로그램이 되기도 하고 49ms짜리 프로그램이 되기도 한다 — 이 절에서 실측한다. 당신이 쓴 C++ 코드와 CPU가 실행하는 기계어는 같은 프로그램이 아니다. 그 사이에서 컴파일러가 계산을 컴파일 타임으로 옮기고, 함수 호출을 지우고, 죽은 코드를 들어내고, 루프를 벡터 명령으로 다시 쓴다. [8.1 프로파일링](#/profiling)이 "어디가 느린가"를 재는 절이라면, 이 절은 그 측정 대상 — 컴파일러가 실제로 만든 코드 — 을 직접 눈으로 읽는 절이다. 도구는 전부 이미 깔려 있다: `g++ -S`, `objdump`, 그리고 컴파일러가 자기 최적화를 스스로 보고하게 만드는 `-fopt-info`.
:::

## 소스 코드는 실행되지 않는다

[1.1 컴파일 모델](#/compile-model)에서 3줄짜리 C++이 42줄의 어셈블리가 되는 것을 봤다. 그때는 번역이 일어난다는 사실 자체가 주제였다. 이 절의 주제는 그 번역이 **충실한 번역이 아니라는 것**이다. 컴파일러는 소스를 명령 단위로 옮겨 적지 않는다 — "이 프로그램의 관찰 가능한 동작(출력, volatile 접근, 시스템 호출)만 같으면 나머지는 전부 바꿔도 된다"는 계약(as-if 규칙) 아래에서, 소스에 쓴 계산을 지우고, 순서를 바꾸고, 아예 컴파일 타임에 끝내 버린다.

그래서 성능 논의는 소스 코드 위에서 성립하지 않는다. "이 함수는 곱셈 두 번에 덧셈 한 번이니까 대략 몇 사이클"이라는 식의 추론은, 그 곱셈이 실제 바이너리에 존재하는지부터 확인하기 전엔 아무 근거가 없다 — 이 절의 첫 실측에서 곱셈과 `sqrt` 호출이 통째로 사라지는 것을 본다. [8.2 캐시와 메모리 레이아웃](#/cache)의 논의도 마찬가지다 — 접근 패턴을 따지려면 컴파일러가 그 루프를 어떤 코드로 만들었는지가 전제다.

확인 도구는 [1.1](#/compile-model)에서 이미 쓴 `-S`다. 컴파일을 어셈블리 생성 단계에서 멈추고 `.s` 텍스트 파일을 남긴다.

```console
$ g++ -std=c++20 -Wall -Wextra -S -O2 -masm=intel reach.cpp -o reach_O2.s
```

::: tip 어셈블리 문법 두 가지와 이 절의 표기
[1.1](#/compile-model)의 발췌는 g++ 기본값인 AT&T 문법이었다(`movl %edx, %eax` — 원본이 왼쪽). 이 절부터는 `-masm=intel`로 Intel 문법을 쓴다 — `mov eax, edx`처럼 **목적지가 왼쪽**이라 대입문처럼 읽혀서 처음 읽기에 낫다. 내용은 완전히 같은 코드다. 그리고 이 절의 모든 어셈블리는 실제 `.s` 파일에서 `.cfi_*` 지시어(디버거·예외 처리용 메타데이터)와 라벨 몇 개를 걷어낸 **발췌**다 — 직접 뽑아 보면 줄이 더 많다.
:::

읽는 데 필요한 최소 문법만 정리한다. 이 절의 발췌를 따라오는 데는 이거면 충분하다.

- 정수 인자는 `rdi, rsi, rdx, ...` 순서로, 부동소수점 인자는 `xmm0, xmm1, ...` 레지스터로 들어온다. 반환값은 정수면 `eax`/`rax`, 부동소수점이면 `xmm0`이다.
- `mov`는 복사, `movsd`는 double 하나 복사, `mulsd`/`addsd`는 double 곱셈/덧셈이다.
- `QWORD PTR .LC0[rip]`는 "코드 근처에 박아 둔 8바이트 상수 `.LC0`을 읽어라"다.
- `call`/`ret`는 함수 호출/복귀, `cmp` + 조건 분기(`je`, `jne`)가 `if`의 몸통이다.

::: note Compiler Explorer라는 도구
소스를 왼쪽에 치면 오른쪽에 어셈블리가 색깔 매핑과 함께 바로 나오는 Compiler Explorer(godbolt라는 이름으로 더 유명하다)라는 웹 도구가 있고, C++ 커뮤니티에서 어셈블리 확인의 표준 도구로 쓰인다. 하는 일 자체는 서버에서 컴파일러를 돌려 `-S` 출력을 정리해 주는 것 — 이 절이 로컬에서 하는 것과 동일하다. 이 책은 오프라인 원칙대로 로컬 `g++ -S`로 전 과정을 진행한다. 소스 줄과 어셈블리 줄의 대응이 궁금하면 로컬에서도 `-g` 를 붙이고 `objdump -dS`로 소스가 끼워진 디스어셈블을 얻을 수 있다.
:::

## 실측 1 — 상수 접기: 계산이 컴파일 타임에 끝난다

헥사포드 다리의 최대 도달 거리를 계산하는 함수다. 링크 길이는 하드웨어 스펙이라 소스에 상수로 박혀 있다 — 이런 값은 로봇 코드 어디에나 있다(링크 길이, 기어비, 서보 펄스 범위).

```cpp title="reach.cpp"
#include <cmath>

// 헥사포드 다리: 링크 길이는 하드웨어 스펙 — 컴파일 타임에 이미 정해진 값이다
double leg_max_reach() {
    double femur  = 80.0;                              // mm
    double tibia  = 128.0;                             // mm
    double reach2 = femur * femur + tibia * tibia;
    return std::sqrt(reach2);
}
```

`-O0`(최적화 없음)의 출력부터. 소스를 거의 문장 단위로 받아 적었다.

```text nolines
_Z13leg_max_reachv:                          ; -O0, excerpt
        endbr64
        push    rbp
        mov     rbp, rsp
        sub     rsp, 32
        movsd   xmm0, QWORD PTR .LC0[rip]    ; 80.0
        movsd   QWORD PTR -24[rbp], xmm0     ; femur -> stack
        movsd   xmm0, QWORD PTR .LC1[rip]    ; 128.0
        movsd   QWORD PTR -16[rbp], xmm0     ; tibia -> stack
        movsd   xmm0, QWORD PTR -24[rbp]
        movapd  xmm1, xmm0
        mulsd   xmm1, xmm0                   ; femur * femur
        movsd   xmm0, QWORD PTR -16[rbp]
        mulsd   xmm0, xmm0                   ; tibia * tibia
        addsd   xmm0, xmm1
        movsd   QWORD PTR -8[rbp], xmm0      ; reach2 -> stack
        mov     rax, QWORD PTR -8[rbp]
        movq    xmm0, rax
        call    sqrt@PLT
        leave
        ret
```

변수마다 스택에 내렸다 올리고, 곱셈 두 번, 덧셈 한 번, `sqrt` 라이브러리 호출까지 소스에 쓴 그대로 다 있다. 이제 같은 소스를 `-O2`로.

```text nolines
_Z13leg_max_reachv:                          ; -O2, full body
        endbr64
        movsd   xmm0, QWORD PTR .LC0[rip]
        ret
...
.LC0:
        .long   -966621375                   ; two halves of one double:
        .long   1080221234                   ; 150.94369811290565
```

(g++ 13.3.0 / Ubuntu 24.04 x86-64 실측.) 함수 몸통이 **상수 하나를 반환 레지스터에 싣는 한 줄**이다. `.LC0`의 두 `.long`을 붙여 double로 해석하면 150.94369811290565 — 정확히 $\sqrt{80^2 + 128^2} = \sqrt{22784}$다. 곱셈도, 덧셈도, `sqrt` 호출도 실행 파일에 존재하지 않는다. 컴파일러가 한 일을 이름 붙여 부르면 이렇다.

- **상수 전파(constant propagation)**: `femur`가 항상 80.0이라는 사실을 뒤 문장들로 흘려보낸다.
- **상수 접기(constant folding)**: 피연산자가 전부 상수인 연산(`80.0 * 80.0`, 그리고 `sqrt(22784.0)`까지)을 컴파일 타임에 계산해 결과로 치환한다.
- **죽은 코드 제거(dead code elimination)**: 결과에 더 이상 기여하지 않는 코드 — 스택에 `femur`를 저장하던 명령들 — 를 들어낸다.

세 가지는 한 몸으로 돈다. 전파가 접기를 가능하게 하고, 접기가 코드를 죽이고, 제거가 판을 정리하면 다시 전파할 거리가 생긴다. 옵티마이저는 이런 패스를 고정점에 도달할 때까지 반복한다.

::: deep -O0에서도 접히는 것이 있다
이 데모에서 계산을 일부러 여러 문장으로 쪼갰다. `return std::sqrt(80.0 * 80.0 + 128.0 * 128.0);`처럼 **한 식**으로 쓰면 `-O0`에서도 `.LC` 상수 하나로 접힌다 — 이 환경에서 실측으로 확인했다. 한 식 안의 상수 연산은 옵티마이저가 아니라 컴파일러 프런트엔드가 접기 때문이다(`constexpr` 문맥 평가에도 어차피 필요한 능력이다). [2.11](#/ub-sanitizers)에서 `x + 1 > x` 분기가 `-O0`에서도 사라졌던 것도 같은 이유다. "-O0이니까 소스 그대로겠지"라는 가정조차 항상 성립하지는 않는다 — 확인은 언제나 어셈블리로 한다.
:::

## 실측 2 — 인라이닝: 호출 자체가 사라진다

작은 함수를 통해 계산하는 코드다.

```cpp title="inline_demo.cpp"
double square(double x) { return x * x; }

double norm2(double x, double y) {
    return square(x) + square(y);
}
```

`-O0`에서 `norm2`는 소스 그대로 `call _Z6squared`를 두 번 한다. 인자를 스택에 저장하고, 꺼내서 레지스터에 싣고, 호출하고, 반환값을 다시 스택에 내리는 왕복이 붙는다. `-O2`는 이렇다.

```text nolines
_Z5norm2dd:                                  ; -O2, full body
        endbr64
        mulsd   xmm1, xmm1                   ; y * y
        mulsd   xmm0, xmm0                   ; x * x
        addsd   xmm0, xmm1
        ret
```

`call`이 없다. `square`의 몸통이 호출 지점에 그대로 녹아들었다 — **인라이닝(inlining)**이다. 컴파일러에게 왜 그랬는지 물어볼 수도 있다.

```console
$ g++ -std=c++20 -O2 -fopt-info-inline -c inline_demo.cpp -o inline_demo.o
inline_demo.cpp:4:30: optimized:  Inlining double square(double)/0 into double norm2(double, double)/1.
inline_demo.cpp:4:18: optimized:  Inlining double square(double)/0 into double norm2(double, double)/1.
```

반대로 인라이닝을 금지하면 어떻게 되는지도 본다. `square` 정의 앞에 `__attribute__((noinline))`을 붙이고 다시 `-O2`로 컴파일하면:

```text nolines
_Z5norm2dd:                                  ; -O2 + noinline, full body
        endbr64
        call    _Z6squared
        movapd  xmm2, xmm0                   ; keep x*x
        movapd  xmm0, xmm1
        call    _Z6squared
        addsd   xmm0, xmm2
        ret
```

`call` 두 개가 되살아났다. `__attribute__((noinline))`은 GCC/Clang 확장으로, 프로파일링에서 함수 경계를 유지하고 싶을 때([8.1](#/profiling)) 또는 이 절처럼 코드 생성을 관찰할 때 쓴다.

인라이닝의 가치는 `call`/`ret` 몇 사이클을 아끼는 게 아니다. 진짜 가치는 **호출 경계가 사라지면서 다른 최적화가 그 경계를 넘어 작동하게 되는 것**이다. 실측 1의 상수 전파는 함수 몸통 안에서만 돌았지만, `square`가 인라이닝되면 호출 인자가 상수인 경우 그 상수가 `square`의 몸통 안까지 전파된다 — 인라이닝이 접기와 제거의 무대를 넓힌다. 그래서 인라이닝을 "최적화를 가능하게 하는 최적화(enabling optimization)"라고 부른다.

::: note `inline` 키워드는 인라이닝 지시가 아니다
현대 C++에서 `inline` 키워드의 실질 의미는 링크 규칙이다 — "이 정의가 여러 번역 단위에 중복돼도 하나로 병합해라"([4.3 템플릿 인스턴스화의 실체](#/template-mechanics)에서 `nm`으로 본 `W` 약한 심볼이 정확히 그것이다). 실제 인라이닝 여부는 키워드와 무관하게 옵티마이저가 비용 모델로 결정한다 — 위 실측에서 `square`에는 아무 키워드도 없었지만 `-O2`가 알아서 인라이닝했다. 헤더에 정의를 두려고 `inline`을 쓰는 것이지, 빨라지라고 쓰는 게 아니다.
:::

::: deep noinline 버전에 레지스터 저장이 없는 이유
위 noinline 어셈블리를 자세히 보면 이상한 데가 있다. `xmm1`(인자 `y`)과 `xmm2`(첫 결과)는 x86-64 호출 규약상 호출자 저장(caller-saved) 레지스터라, 원칙대로라면 `call` 전에 스택에 대피시켜야 한다. 그런데 저장이 없다. `square`의 정의가 같은 번역 단위에 있어서, GCC가 **프로시저 간 레지스터 할당(IPA-RA)**으로 "`square`는 `xmm0` 말고는 안 건드린다"는 사실을 확인하고 대피를 생략한 것이다. 인라이닝을 막아도 컴파일러는 함수 경계 너머를 본다 — `-O2`가 하는 일은 생각보다 넓다.
:::

::: interview "컴파일러 최적화 중 하나만 꼽으라면?"
"가장 중요한 컴파일러 최적화가 뭐라고 생각하나"류의 질문에는 인라이닝을 꼽고 이유를 대는 게 정석이다. 답변 뼈대: ① 호출 오버헤드 제거 자체는 부수 효과다. ② 본질은 호출 경계를 지워서 상수 전파·죽은 코드 제거·벡터화 같은 다른 최적화가 함수 사이를 넘나들게 만드는 것("enabling optimization"). ③ 그래서 가상 함수 호출이 비싼 진짜 이유도 간접 호출 몇 사이클이 아니라 **인라이닝이 막히는 것**이라고 잇는다 — 타깃을 컴파일 타임에 모르니 몸통을 녹일 수 없고, 뒤따르는 최적화 전부가 같이 막힌다.
:::

## 최적화 수준 — 같은 루프를 다섯 번 빌드해서 잰다

이제 수준별 차이를 시간으로 잰다. 상수로 접히지 않도록 데이터는 실행 시점에 만들고, 결과를 출력해서 루프가 살아남게 한다.

```cpp title="bench_opt.cpp"
#include <chrono>
#include <cstdio>
#include <vector>

int main() {
    const int N = 2000;
    std::vector<double> a(N);
    for (int i = 0; i < N; ++i) a[i] = 0.001 * i;   // 실행 시점에야 정해지는 데이터

    auto t0 = std::chrono::steady_clock::now();
    double acc = 0.0;
    for (int rep = 0; rep < 20000; ++rep)
        for (int i = 0; i < N; ++i)
            acc += a[i] * a[i] + 0.5 * a[i];        // 4천만 번의 곱셈·덧셈
    auto t1 = std::chrono::steady_clock::now();

    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    printf("acc=%.3f elapsed_ms=%.1f\n", acc, ms);  // acc를 출력해야 루프가 살아남는다
    return 0;
}
```

```console
$ for lvl in 0 1 2 3 s; do g++ -std=c++20 -Wall -Wextra -O$lvl bench_opt.cpp -o bench_O$lvl; done
```

각 5회 실행, 중앙값이다(g++ 13.3.0 / Ubuntu 24.04 x86-64 실측. 절대값은 기기마다 다르지만 배수 관계는 어디서나 비슷하다). `.text`는 `size -A`로 잰 코드 섹션 크기다.

| 빌드 | 실행 시간(중앙값, 5회) | 배수 | `.text` 크기 |
| --- | --- | --- | --- |
| `-O0` | 265.1 ms | 5.4배 | 3,979 B |
| `-O1` | 110.6 ms | 2.2배 | 526 B |
| `-O2` | 49.2 ms | 1.0배 | 585 B |
| `-O3` | 49.1 ms | 1.0배 | 689 B |
| `-Os` | 49.0 ms | 1.0배 | 598 B |

플래그 하나로 5.4배다. 눈에 띄는 사실 세 가지.

첫째, `-O0`은 느릴 뿐 아니라 코드도 7배 크다 — 실측 1에서 봤듯 모든 변수를 매번 스택에 내렸다 올리기 때문이다. `-O0`의 존재 이유는 성능이 아니라 디버깅이다: 모든 변수가 실제 메모리에 살아 있고 모든 문장이 소스 순서대로 실행되므로, gdb에서 아무 줄에나 멈춰 아무 변수나 볼 수 있다. 최적화된 빌드에서는 변수가 레지스터에만 살거나 아예 증발해서 디버거가 `<optimized out>`을 보여주는 일이 흔하다.

둘째, **이 벤치마크에서 `-O2`와 `-O3`는 같은 시간이 나왔다.** [7.2 CMake 심화](#/cmake-advanced)에서 "Release는 `-O3`"를 실측하며 이 차이를 8.3에서 벤치마크한다고 예고했었다 — 결과가 이것이다. `-O3`는 `-O2` 위에 더 공격적인 루프 최적화(적극적 벡터화, 루프 필링·언스위칭 등)를 얹는데, **그 최적화가 적용될 거리가 없는 코드에서는 아무것도 더 얻지 못한다.** 이 루프가 왜 그 "거리"가 없는지는 다음 섹션에서 컴파일러 자신의 보고서로 확인한다. `-O3`가 코드 크기를 키워서(위 표에서도 689B로 최대) 명령 캐시에 불리해지면 오히려 느려지는 경우도 있다 — "숫자가 크면 빠르다"가 아니라 **재 보기 전엔 모른다**가 정답이다.

셋째, `-Os`는 `-O2`에서 코드 크기를 키우는 최적화만 뺀 것이다. 이 환경의 x86-64에서는 쓸 일이 드물지만, 플래시 몇백 KB짜리 MCU 펌웨어(로봇의 모터 드라이버 보드가 정확히 그런 물건이다)에서는 기본값이 된다.

::: warn 결과를 관찰하지 않는 벤치마크는 벤치마크가 아니다
위 소스에서 `printf`의 `acc` 출력을 지우고 `-O2`로 다시 재면 **0.0ms**가 나온다 — 이 환경에서 실측했다. `acc`가 관찰되지 않는 순간 4천만 번의 곱셈·덧셈 전체가 죽은 코드가 되어 루프째 증발한다. as-if 규칙의 당연한 귀결이지만, "최적화 켜니까 1000배 빨라졌다"는 착각의 최대 공급원이다. 이 함정과의 싸움은 [8.6 마이크로벤치마크의 함정](#/benchmarking)에서 본격적으로 다룬다.
:::

::: interview "-O2와 -O3의 차이는?"
실무 감각을 재는 단골 질문이다. 답변 뼈대: ① `-O2`는 사실상 모든 안전한 최적화(인라이닝, 상수 전파, DCE, 스케줄링)를 켠 실무 표준이다. ② `-O3`는 거기에 코드 크기 증가를 감수하는 공격적 루프 최적화를 얹는다 — 벡터화 적용 범위 확대가 대표다. ③ 그래서 차이는 "루프가 지배하고 벡터화가 먹히는 코드"에서만 난다 — 이 절의 실측처럼 벡터화가 막힌 루프에서는 동률이고, 코드가 커져 캐시에 불리해지면 역전도 있다. ④ 결론은 "기본 `-O2`, `-O3`는 재 보고 결정" — CMake Release가 `-O3`를 쓴다는 사실([7.2](#/cmake-advanced) 실측)까지 붙이면 상급이다.
:::

## 컴파일러가 스스로 보고하게 만든다 — -fopt-info

`-O3`가 이 루프에서 아무것도 못 얻은 이유를 컴파일러에게 직접 물을 수 있다. `-fopt-info-vec`은 벡터화에 **성공한** 루프를, `-fopt-info-vec-missed`는 **실패한** 루프와 이유를 표준 에러로 보고한다. 먼저 성격이 다른 루프 두 개로 보고서 읽는 법부터.

```cpp title="vec_demo.cpp"
// 벡터화되는 루프: 반복 간 의존이 없다
void scale_all(float* out, const float* in, float k, int n) {
    for (int i = 0; i < n; ++i)
        out[i] = in[i] * k;
}

// 벡터화 안 되는 루프: 중간에 빠져나갈 수 있다
float sum_until(const float* v, int n, float limit) {
    float s = 0.0f;
    for (int i = 0; i < n; ++i) {
        s += v[i];
        if (s > limit) break;
    }
    return s;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O3 -fopt-info-vec -c vec_demo.cpp -o vec_demo.o
vec_demo.cpp:3:23: optimized: loop vectorized using 16 byte vectors
vec_demo.cpp:3:23: optimized:  loop versioned for vectorization because of possible aliasing
vec_demo.cpp:3:23: optimized: loop vectorized using 8 byte vectors

$ g++ -std=c++20 -Wall -Wextra -O3 -fopt-info-vec-missed -c vec_demo.cpp -o vec_demo.o
vec_demo.cpp:11:16: missed: couldn't vectorize loop
vec_demo.cpp:11:16: missed: not vectorized: control flow in loop.
```

(g++ 13.3.0 실측.) 두 줄만 해석하면 된다. `scale_all`은 16바이트 벡터(float 4개 동시)로 벡터화됐고, `versioned ... because of possible aliasing`은 "`out`과 `in`이 같은 메모리를 가리킬 가능성을 배제 못 해서, 실행 시점에 겹침을 검사해 벡터판/스칼라판으로 갈라지는 코드를 만들었다"는 뜻이다. `sum_until`은 `control flow in loop` — 루프 중간의 `break` 때문에 반복 횟수를 미리 알 수 없어 실패했다.

같은 플래그를 `-O2`로 주면 이 환경에서는 **아무 출력이 없다** — 실측이다. g++ 13의 `-O2`도 벡터화 패스 자체는 켜져 있지만 "비용이 사실상 0일 때만"이라는 극도로 소극적인 비용 모델을 쓰기 때문에, 앨리어싱 검사용 버전 분기가 필요한 이 루프는 손대지 않는다. `-O3`부터 비용 모델이 공격적으로 바뀐다 — 앞 섹션에서 "-O3의 대표 추가 항목이 벡터화"라고 한 근거다.

이제 앞 벤치마크의 의문을 푼다. `bench_opt.cpp`를 `-O3 -fopt-info-vec-missed`로 컴파일하면 핵심 루프에 대해 이렇게 보고한다(실측, 관련 줄만 발췌):

```console
$ g++ -std=c++20 -O3 -fopt-info-vec-missed -c bench_opt.cpp -o bench.o
bench_opt.cpp:12:27: missed: couldn't vectorize loop
```

`acc += ...`는 이전 반복의 `acc`에 의존하는 **리덕션(reduction)**인데, 부동소수점 덧셈은 결합법칙이 성립하지 않아서 덧셈 순서를 재배열하는 벡터화가 결과 비트를 바꿀 수 있다 — 컴파일러는 그런 변환을 기본값에서는 하지 않는다. 증거로, 재배열을 허용하는 `-ffast-math`를 얹으면 이 환경에서 같은 루프가 `optimized: loop vectorized using 16 byte vectors`로 보고되고 실행 시간이 중앙값 25.0ms — `-O2`의 절반 — 로 떨어진다(5회 실측). 벡터화를 돕는 코드 작성법과 그 대가는 [8.5 SIMD 기초](#/simd)의 몫이고, 이 절에서 가져갈 것은 하나다: **컴파일러가 무엇을 했고 무엇을 포기했는지는 추측하지 말고 `-fopt-info`로 보고받아라.**

::: tip 다른 패스의 보고서
`-fopt-info-vec`은 벡터화 패스만 보는 필터다. 위에서 쓴 `-fopt-info-inline`(인라이닝), `-fopt-info-loop`(루프 변환) 등 패스별 필터가 있고, `-fopt-info-missed`로 모든 패스의 실패 보고를 한꺼번에 받을 수도 있다 — 단, 출력이 수백 줄이라 특정 파일·특정 루프를 조준할 때만 쓸 만하다.
:::

::: danger -ffast-math는 성능 플래그가 아니라 정확도 계약 변경이다
`-ffast-math`는 "IEEE 754 결과를 비트 단위로 보존하라"는 계약을 깨고 재배열·역수 근사 등을 허용한다. 위 실측처럼 2배가 공짜로 생기는 것처럼 보이지만, 결과가 달라지는 것을 허락한 대가다. NaN/무한대 처리도 달라진다(`-ffinite-math-only` 포함). 칼만 필터 공분산 갱신처럼 수치 안정성이 아슬아슬한 계산(Part IX)에 전역으로 켜는 것은 도박이다 — 켜려면 파일 단위로, 결과 검증과 함께.
:::

## UB는 최적화의 근거다

[2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 `-O2`가 오버플로 검사 `if`를 통째로 지우는 것을 `objdump`로 봤다. 그때는 안전의 관점 — "방어 코드가 증발한다" — 이었다. 이 절에서는 같은 사건을 컴파일러의 관점에서 최소 재현으로 다시 본다.

```cpp title="ub_fold.cpp"
bool still_bigger(int x) {
    return x + 1 > x;   // x == INT_MAX면 오버플로 -> UB
}
```

```text nolines
_Z12still_biggeri:                           ; -O2, full body
        endbr64
        mov     eax, 1
        ret
```

(g++ 13.3.0 / `-O2` 실측.) 인자 `x`를 읽지도 않는다. **함수 전체가 `return true`로 접혔다.** 논리는 이렇다: signed 오버플로는 UB다 → UB가 일어나는 실행은 "없는 경우"로 취급해도 된다 → 남는 모든 경우에서 `x + 1 > x`는 참이다 → 상수 접기. 실측 1의 상수 접기와 완전히 같은 기계가 도는데, 접기의 근거가 "피연산자가 상수라서"가 아니라 **"언어 규칙상 반례가 존재할 수 없어서"**라는 점만 다르다. UB는 컴파일러에게 버그가 아니라 **가정해도 되는 사실의 목록**이다.

가정을 끄면 코드가 되살아나는 것도 어셈블리로 확인된다. `-fwrapv`(signed 오버플로를 랩어라운드로 정의)를 주면:

```text nolines
_Z12still_biggeri:                           ; -O2 -fwrapv, full body
        endbr64
        cmp     edi, 2147483647              ; x == INT_MAX ?
        setne   al
        ret
```

이번엔 진짜로 `x`를 `INT_MAX`와 비교한다 — 랩어라운드가 정의된 세계에서는 `x == INT_MAX`일 때만 거짓이기 때문이다. 같은 원리가 성능 쪽으로도 작동한다: 루프 카운터가 `int`면 "오버플로는 없다"는 가정 덕에 컴파일러가 반복 횟수를 확정하고 벡터화·언롤링을 진행할 수 있다. [2.11](#/ub-sanitizers)의 `::: deep`("이 가정이 성능 자산인 이유")이 말한 그대로다 — UB의 위험과 최적화 여지는 같은 동전의 양면이다.

## 바이너리 쪽에서 확인한다 — objdump와 nm

`-S`는 컴파일러가 **만들려는** 코드를 보여준다. 실행 파일이나 오브젝트 파일에 **실제로 들어간** 코드는 `objdump -d`(역어셈블)로 본다 — [2.11](#/ub-sanitizers)에서 이미 쓴 도구다. noinline 버전 오브젝트 파일로 두 도구를 겹쳐 본다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 -c noinline_demo.cpp -o noinline_demo.o
$ nm -C noinline_demo.o
0000000000000010 T norm2(double, double)
0000000000000000 T square(double)
$ objdump -d -M intel --disassemble='_Z5norm2dd' noinline_demo.o
0000000000000010 <_Z5norm2dd>:
  10:  f3 0f 1e fa       endbr64
  14:  e8 00 00 00 00    call   19 <_Z5norm2dd+0x9>
  19:  66 0f 28 d0       movapd xmm2,xmm0
  1d:  66 0f 28 c1       movapd xmm0,xmm1
  21:  e8 00 00 00 00    call   26 <_Z5norm2dd+0x16>
  26:  f2 0f 58 c2       addsd  xmm0,xmm2
  2a:  c3                ret
```

(binutils 2.42 실측.) `-S` 출력과 같은 코드가 이제 기계어 바이트와 함께 보인다. `call`의 피연산자가 `e8 00 00 00 00` — 주소 자리가 0으로 비어 있다. [1.1](#/compile-model)에서 "다른 심볼로 점프하는 자리는 이름만 적힌 빈칸으로 남는다"고 했던 그 빈칸을 지금 바이트 단위로 보고 있는 것이다 — 링커가 재배치로 채운다. `nm -C`는 [4.3](#/template-mechanics)에서 쓴 그대로 심볼 목록을 디맹글해서 보여준다. 셋의 역할 분담은 이렇다: `g++ -S`는 사람이 읽을 어셈블리, `nm`은 "이 파일에 어떤 함수가 있는가", `objdump -d`는 "그 함수에 실제로 어떤 명령이 들어갔는가".

## 로보틱스 연결 — 제어 루프는 어떤 빌드로 재는가

이 절의 숫자를 로봇에 대입하면 규칙 하나가 저절로 나온다. [6.8 실시간 제약과 제어 루프](#/realtime)의 제어 주기 예산 — 이를테면 1kHz 루프의 1ms — 을 논할 때, `-O0 -g` 디버그 빌드에서 잰 수치는 **아무 의미가 없다.** 이 절의 실측만으로 같은 계산 코드가 5.4배 차이 났다. 디버그 빌드에서 주기를 넘겨서 "보드가 느리다", "알고리즘을 바꿔야 한다"는 결론을 내리는 것은 존재하지 않는 문제를 푸는 일이다. 성능에 대한 모든 판단은 최적화 빌드에서 잰 수치로만 한다.

그러면 배포 빌드에서 크래시가 났을 때 백트레이스는 어떻게 얻는가 — 여기서 [7.2](#/cmake-advanced)에서 실측한 RelWithDebInfo(`-O2 -g -DNDEBUG`)가 실무 기본값이 되는 이유가 완성된다. 핵심은 **`-g`가 코드 생성에 영향을 주지 않는다**는 사실이다. 이 환경에서 `-O2`와 `-O2 -g`로 같은 벤치마크를 빌드해 비교하면 `.text` 크기가 585바이트로 동일하고 실행 시간도 49ms 안팎으로 동일하다(실측). `-g`는 디버그 정보를 **별도 섹션**에 얹을 뿐, 기계어 명령은 한 바이트도 바꾸지 않는다. 즉 "성능이냐 디버깅 정보냐"는 애초에 트레이드오프가 아니다 — 트레이드오프는 `-O0`이냐 `-O2`냐(디버깅 **편의성** 대 성능)에만 있다. 그래서 ROS 2 워크스페이스의 실전 기본은 `colcon build --cmake-args -DCMAKE_BUILD_TYPE=RelWithDebInfo`다: 제어 루프는 `-O2`의 성능으로 돌고, 필드에서 죽으면 코어 덤프에서 함수·줄 번호가 나온다. 단, `-O2`에서는 인라이닝·코드 재배치 때문에 gdb에서 변수가 `<optimized out>`으로 보이거나 실행 순서가 소스와 어긋나는 건 감수해야 한다 — 그 불편이 진짜 괴로운 버그 재현 때만 `-O0` Debug 빌드로 내려간다.

::: perf 이 절 실측 요약 (g++ 13.3.0 / Ubuntu 24.04 x86-64)
같은 4천만 회 곱셈·덧셈 루프: `-O0` 265.1ms → `-O2` 49.2ms(5.4배), `-O3`·`-Os` 동률 49ms(벡터화 불가 루프), `-O3 -ffast-math` 25.0ms(리덕션 벡터화 허용 시). `-O2` 대 `-O2 -g`: 실행 시간·`.text` 크기 완전 동일 — 디버그 정보는 성능 비용이 0이다.
:::

## 요약

- 컴파일러는 관찰 가능한 동작만 보존하면 코드를 마음대로 바꾼다(as-if 규칙) — 성능 논의는 소스가 아니라 생성된 코드 위에서만 성립하고, 그 코드는 `g++ -S -masm=intel`과 `objdump -d`로 직접 본다.
- 상수 전파·상수 접기·죽은 코드 제거는 한 몸으로 돈다 — 실측: 링크 길이 계산 함수가 `-O2`에서 `sqrt` 호출까지 사라지고 상수 150.9436...을 싣는 한 줄이 됐다.
- 인라이닝은 호출 비용 제거가 아니라 다른 최적화의 무대를 넓히는 "enabling optimization"이다 — 실측: `-O2`에서 `call`이 사라지고, `__attribute__((noinline))`로 되살아난다. `inline` 키워드는 링크 규칙이지 인라이닝 지시가 아니다.
- 실측 배수: `-O0` 대 `-O2`가 5.4배. `-O2`가 실무 표준, `-O3`는 루프·벡터화 거리가 있어야만 더 빠르며(이 절 벤치마크에선 동률) `-Os`는 크기 우선. CMake Release는 `-O3`, RelWithDebInfo는 `-O2 -g`다([7.2](#/cmake-advanced) 실측).
- 컴파일러가 어떤 루프를 벡터화했고 왜 포기했는지는 `-fopt-info-vec`/`-fopt-info-vec-missed`로 보고받는다 — 실측: 앨리어싱 버전 분기, `control flow in loop` 실패, 부동소수점 리덕션이 `-ffast-math`에서만 벡터화되는 것까지 전부 보고서에 나온다. 깊이는 [8.5 SIMD 기초](#/simd)에서.
- UB는 컴파일러가 "일어나지 않는다고 가정해도 되는 사실"이다 — 실측: `x + 1 > x`가 `-O2`에서 `mov eax, 1`로 접히고, `-fwrapv`로 가정을 끄면 진짜 비교가 되살아난다.
- `-g`는 코드 생성을 바꾸지 않는다(실측: 크기·시간 동일) — 실시간 제어 루프의 성능은 반드시 최적화 빌드로 재고, 실무 기본값은 RelWithDebInfo다.

::: quiz 연습문제
1~3번은 개념·예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. 실측 1의 `-O2` 어셈블리에는 곱셈 명령이 하나도 없다. 상수 전파·상수 접기·죽은 코드 제거 세 패스가 각각 이 함수에 무엇을 했는지, 서로 어떻게 꼬리를 무는지 설명하라.

2. 동료가 "핫 루프의 작은 함수마다 `inline` 키워드를 붙여서 빨라지게 했다"고 말한다. 이 주장에서 무엇이 틀렸고, 인라이닝 여부를 실제로 확인하려면 어떤 명령을 쳐야 하는지 답하라(두 가지 이상).

3. (예측) `bench_opt.cpp`의 안쪽 루프에서 `acc`(double)를 `long` 정수 누적으로 바꾸고 `a[i]` 대신 정수 배열을 쓰면, `-O3 -fopt-info-vec`의 보고가 어떻게 달라질지 예측하고 근거를 써라. 힌트: 이 루프가 벡터화에 실패한 이유는 부동소수점 덧셈의 비결합성이었다.

4. (실습, 코드 작성형) 인자 두 개를 받아 사칙연산 몇 번을 하는 함수와, 그 함수를 상수 인자로 호출해 결과를 반환하는 두 번째 함수를 직접 작성하라. `g++ -std=c++20 -Wall -Wextra -S -O0 -masm=intel`과 `-O2`로 각각 어셈블리를 뽑아, `-O2`에서 첫 함수의 호출이 사라지고 두 번째 함수가 상수 하나를 싣는 한 줄이 되는지 확인하는 것이 성공 기준이다. 그다음 `__attribute__((noinline))`을 붙여 `call`이 되살아나는 것까지 확인하라.

5. (실습) 이 절의 `vec_demo.cpp`를 직접 타이핑하고 `g++ -std=c++20 -O3 -fopt-info-vec -fopt-info-vec-missed -c`로 두 보고를 한 번에 받아라. 그다음 `scale_all`의 루프 안에 `if (in[i] < 0.0f) break;` 한 줄을 넣고 다시 컴파일해서, 벡터화 성공이던 루프가 `control flow in loop` 실패로 바뀌는 것을 네 화면에서 확인하라.
:::

::: answer 해설
1. 상수 전파가 `femur = 80.0`, `tibia = 128.0`이라는 사실을 뒤 문장으로 흘려보내고, 그 결과 피연산자가 전부 상수가 된 `femur * femur + tibia * tibia`와 `sqrt(22784.0)`을 상수 접기가 컴파일 타임에 계산한다(150.94369811290565). 접힌 뒤에는 `femur`·`tibia`를 스택에 저장하던 코드가 결과에 기여하지 않는 죽은 코드가 되어 제거된다. 제거로 코드가 단순해지면 다시 전파·접기 거리가 드러날 수 있어, 옵티마이저는 이 패스들을 변화가 없어질 때까지 반복한다.
2. 틀린 점: 현대 컴파일러에서 `inline` 키워드는 인라이닝 결정에 사실상 영향이 없다 — 실질 의미는 "여러 번역 단위의 중복 정의를 하나로 병합하라"는 링크 규칙이다. 인라이닝은 키워드 없이도 `-O2`가 비용 모델로 알아서 한다(이 절 실측). 확인 방법: ① `-fopt-info-inline`으로 컴파일러의 인라이닝 보고를 직접 받는다, ② `g++ -S` 또는 `objdump -d`로 호출 지점에 `call`이 남아 있는지 본다. (`nm`으로 심볼이 남았는지 보는 것은 보조 수단 — 인라이닝돼도 외부 링크 심볼은 남을 수 있어 단독 근거로는 부족하다.)
3. 정수 덧셈은 결합법칙이 성립하고 오버플로 걱정을 컴파일러가 하는 방식도 다르다(signed 오버플로는 UB라 "안 일어난다"고 가정) — 리덕션 순서 재배열이 결과를 바꾸지 않으므로 `-ffast-math` 없이도 `optimized: loop vectorized ...` 보고가 나올 것으로 예측하는 게 합리적이다. 실제 결과는 네 환경에서 `-fopt-info-vec`으로 확인하라 — 예측과 보고서를 대조하는 것 자체가 이 절의 훈련이다.
4. 성공 기준 그대로다. `-O0`에서는 두 함수 모두 온전한 몸통과 `call`이 있고, `-O2`에서는 두 번째 함수가 실측 1처럼 상수 로드 한 줄(정수면 `mov eax, <값>`, 부동소수점이면 `movsd xmm0, .LC0[rip]`)이 돼야 한다. `noinline`을 붙이면 `call`은 돌아오지만, 인자가 상수인 호출은 여전히 상수 전파의 대상이 아니게 된다는 것 — 인라이닝이 막히면 뒤따르는 최적화도 같이 막힌다는 본문 명제 — 을 눈으로 확인하게 된다.
5. `break`를 넣는 순간 반복 횟수를 미리 알 수 없는 루프가 되므로, `scale_all`에 대한 `optimized: loop vectorized ...` 줄이 사라지고 `missed: ... control flow in loop.`가 나와야 한다(이 절의 `sum_until`과 같은 보고). 한 줄이 벡터화를 통째로 무효화하는 것을 직접 보는 게 목적이다 — 핫 루프 안의 조기 탈출·분기가 왜 비싼지 [8.5 SIMD 기초](#/simd)에서 이어진다.
:::

이 절의 네 데모는 전부 직접 타이핑해서 재현해라. 특히 실측 1은 눈으로 한 번 보기 전까지는 "컴파일러가 알아서 잘 한다"가 실감이 안 난다. 기준 명령: `g++ -std=c++20 -Wall -Wextra -S -O2 -masm=intel reach.cpp -o reach_O2.s && cat reach_O2.s`, 벤치마크는 `for lvl in 0 1 2 3 s; do g++ -std=c++20 -Wall -Wextra -O$lvl bench_opt.cpp -o bench_O$lvl && ./bench_O$lvl; done`, 벡터화 보고는 `g++ -std=c++20 -O3 -fopt-info-vec -fopt-info-vec-missed -c vec_demo.cpp -o vec_demo.o`.

**다음 절**: [8.4 데이터 지향 설계](#/data-oriented) — 컴파일러가 코드를 어디까지 바꿔 주는지 봤으니, 이제 컴파일러도 못 고쳐 주는 것 — 데이터 배치 — 을 설계로 푼다. 객체 지향이 캐시를 죽이는 지점과 로봇 상태 배열 설계를 다룬다.

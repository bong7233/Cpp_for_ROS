# 1.7 배열과 문자열

::: lead
[1.6](#/functions)에서 함수가 인자 하나를 받는 방식을 해부했다. 이 절은 데이터 **여러 개**를 다루는 가장 오래된 두 도구다. C 배열은 함수 경계를 넘는 순간 자기 크기를 잊어버린다 — 컴파일러가 배열을 첫 요소의 주소로 바꿔치기하기 때문이고, 이 바꿔치기(붕괴, decay)를 이해하려면 **포인터 산술**이 이 책에서 처음으로 실전에 등장해야 한다. C 문자열도 같은 뿌리다 — "0이 나올 때까지의 char 배열"이라는 관례일 뿐이라 길이를 물을 때마다 끝까지 걸어가서 센다. 두 결함의 실체를 실측으로 확인한 뒤, 그 결함을 타입으로 막은 `std::array`와 `std::string`까지 간다. 관절 각도 배열과 프레임 이름 문자열 — 로봇 코드가 매일 만지는 두 데이터의 기본기다.
:::

## 함수에 넘긴 배열은 크기를 잊는다

6축 로봇 팔의 관절 각도를 배열로 들고, 출력 함수에 넘겨 보자. `sizeof`로 크기를 물으면 두 곳에서 다른 답이 나온다.

```cpp title="decay.cpp — 같은 배열, 다른 sizeof"
#include <iostream>

void print_all(double joints[6]) {
    std::cout << "sizeof (함수 안) = " << sizeof(joints) << "\n";
}

int main() {
    double joints[6] = {0.1, 0.2, 0.3, 0.4, 0.5, 0.6};
    std::cout << "sizeof (main)    = " << sizeof(joints) << "\n";
    print_all(joints);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra decay.cpp -o decay
decay.cpp:4:50: warning: 'sizeof' on array function parameter 'joints' will return size of 'double*' [-Wsizeof-array-argument]
$ ./decay
sizeof (main)    = 48
sizeof (함수 안) = 8
```

`main`에서는 48 — `double` 8바이트 × 6, 정직하다. 함수 안에서는 **8** — [1.2](#/types)에서 실측한 포인터의 크기다. 배열이 함수로 들어가면서 크기 정보가 증발했다. g++ 13.3은 이 거짓말을 경고 메시지로 정확히 말해 준다: 파라미터 `joints`의 `sizeof`는 `double*`의 크기를 돌려준다고.

이유는 문법의 역사에 있다. **함수 파라미터 자리의 배열 선언은 포인터 선언의 다른 표기일 뿐이다.** 다음 세 선언은 완전히 같은 시그니처다.

```cpp title="조각: 셋 다 같은 함수다"
void print_all(double joints[6]);   // 6은 컴파일러가 읽고 버린다
void print_all(double joints[]);
void print_all(double* joints);
```

`[6]`의 6은 문서 역할만 하는 주석이다. 컴파일러는 검사하지 않는다 — 요소 3개짜리 배열을 넘겨도 컴파일된다. 그래서 C 세계의 함수는 전부 `(포인터, 길이)` 쌍을 받는다. `memcpy(dst, src, n)`, POSIX의 `read(fd, buf, count)` — 길이를 사람이 따로 들고 다니는 설계이고, 그 길이를 잘못 들고 다니는 순간이 버퍼 오버플로의 산실이다.

::: danger sizeof(a)/sizeof(a[0]) 관용구는 함수 안에서 조용히 틀린다
배열 길이를 구하는 고전 관용구 `sizeof(a) / sizeof(a[0])`는 배열이 보이는 스코프에서만 옳다. 위 함수 안에서 쓰면 8 / 8 = **1**이 나온다 — 에러 없이, 6개짜리 배열을 1개짜리로 취급하는 루프가 된다. 관절 6개 중 1번만 갱신하고 조용히 넘어가는 제어 코드를 상상해 보라. 함수 경계를 넘은 배열에는 이 관용구를 절대 쓰지 마라. 현대 C++의 답은 아래 `std::array`(크기가 타입에 있다)와 `std::size()`다.
:::

## 배열의 실체: 연속 메모리와 포인터 산술

크기가 왜 포인터 하나로 뭉개질 수 있는가. 배열의 메모리 배치가 그만큼 단순하기 때문이다 — **요소들이 틈 없이 연속으로 놓인다.** 주소를 직접 찍어 확인한다.

```cpp title="walk.cpp — 배열 주소 걷기"
#include <iostream>

int main() {
    int a[4] = {10, 20, 30, 40};

    std::cout << "a       = " << a << "\n";
    std::cout << "&a[0]   = " << &a[0] << "\n";
    std::cout << "&a[1]   = " << &a[1] << "\n";
    std::cout << "&a[2]   = " << &a[2] << "\n";
    std::cout << "a + 2   = " << a + 2 << "\n";

    std::cout << "a[2]    = " << a[2] << "\n";
    std::cout << "*(a+2)  = " << *(a + 2) << "\n";
    std::cout << "2[a]    = " << 2[a] << "\n";   // 합법이다
    std::cout << std::boolalpha
              << "same?   = " << (a[2] == *(a + 2)) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra walk.cpp -o walk
$ ./walk
a       = 0x7ffd1b3761d0
&a[0]   = 0x7ffd1b3761d0
&a[1]   = 0x7ffd1b3761d4
&a[2]   = 0x7ffd1b3761d8
a + 2   = 0x7ffd1b3761d8
a[2]    = 30
*(a+2)  = 30
2[a]    = 30
same?   = true
```

(주소 절대값은 ASLR 때문에 실행마다 다르다 — 끝자리의 간격만 보라.) 읽어낼 사실이 세 개다.

첫째, `a`를 그냥 출력하면 `&a[0]`과 같은 주소가 나온다 — 배열 이름이 첫 요소의 주소로 **붕괴(decay)** 한 것이다. 둘째, 주소가 정확히 4씩 증가한다. `sizeof(int)` = 4이므로, 요소들이 빈틈 없이 붙어 있다는 증거다. 셋째, `a + 2`가 `&a[2]`와 같다 — 포인터에 정수를 더하면 바이트가 아니라 **요소 단위**로 이동한다. `int*`의 +1은 4바이트, `double*`의 +1은 8바이트다. 컴파일러가 타입 크기를 알아서 곱해 준다.

이 세 사실을 합치면 인덱싱의 정체가 나온다. **`a[i]`는 `*(a + i)`의 문법 설탕이다.** "첫 주소에서 i개만큼 간 곳의 값"— 실측에서 `a[2]`와 `*(a+2)`가 같은 30을 낸 것이 그 증거다. 그리고 괴상한 `2[a]`가 컴파일되는 이유도 여기 있다: `2[a]`는 정의상 `*(2 + a)`이고, 덧셈은 교환법칙이 성립하므로 `*(a + 2)`와 같다. 쓰라는 말이 아니다 — 인덱싱이 곧 덧셈이라는 사실의 가장 짧은 증명이라 보여줬다.

### 붕괴(decay)의 정확한 규칙

지금까지 "배열 이름이 포인터가 된다"고 뭉뚱그렸다. 정확한 규칙은 이렇다. **배열 타입의 표현식은 대부분의 문맥에서 "첫 요소를 가리키는 포인터" 값으로 변환된다.** 함수 인자로 넘길 때, 산술식에 들어갈 때, 포인터 변수에 대입될 때 — 전부 붕괴한다. 예외, 즉 배열이 배열인 채로 남는 문맥은 몇 개 안 된다:

- **`sizeof`의 피연산자** — 그래서 `main`의 `sizeof(joints)`는 48이었다.
- **단항 `&`의 피연산자** — `&a`는 "첫 요소의 주소"가 아니라 "배열 전체의 주소"다. 타입이 `int(*)[4]`로, 값은 같아도 +1 하면 16바이트를 건너뛴다.
- **`decltype` 등 컴파일 타임 문맥** — 타입을 묻는 것이지 값을 쓰는 게 아니다.
- **배열 참조에 바인딩될 때** — `int (&r)[4] = a;`는 크기까지 통째로 잡는다. 템플릿이 배열 크기를 추론하는 통로다.
- **문자열 리터럴로 배열을 초기화할 때** — `char buf[] = "hi";`는 복사이지 붕괴가 아니다(아래 문자열 절).

머리로만 굴리지 말고 직접 굴려 보라. 아래 위젯이 `walk.cpp`와 같은 배열 `int arr[4] = {10,20,30,40}` 위에서 포인터를 움직인다.

::: widget pointer-diagram
{ "scenario": "array-walk" }
:::

버튼을 눌러 조작하라. `p++`를 누를 때마다 주소가 정확히 4씩 늘어나는 것, `p = arr`이 첫 요소로의 붕괴라는 것, 그리고 `p = arr + 4`가 만드는 **one-past-end** 포인터 — 마지막 요소의 바로 다음 — 까지는 합법이라 루프 종료 조건(`p != arr + 4`)에 쓰이지만 그 자리를 역참조하면 미정의 동작이라는 것까지, 각 연산의 설명문과 함께 확인하라. `p++`로 배열 끝을 넘긴 뒤 `*p = 0`을 눌러 보는 것도 잊지 마라 — 다음 소절이 정확히 그 이야기다.

::: interview 배열과 포인터는 무엇이 다른가
"배열과 포인터의 차이를 설명하라"는 C/C++ 면접의 단골이다. "배열은 포인터다"라고 답하면 탈락 문항이다. 답변 뼈대: ① 배열은 **타입에 크기가 포함된**(`int[4]`) 요소들의 연속 메모리 그 자체이고, 포인터는 주소 하나를 담는 변수다 — `sizeof`가 각각 16과 8을 내는 것이 증거다. ② 다만 배열 표현식은 대부분의 문맥에서 첫 요소 포인터로 **붕괴**하며, 예외는 `sizeof`, 단항 `&`, `decltype`, 배열 참조 바인딩이다. ③ 함수 파라미터의 배열 선언(`int a[6]`)은 포인터 선언의 표기 변형일 뿐이라 크기 정보가 소실된다 — 그래서 C API는 길이를 따로 받고, 현대 C++은 `std::array`와 `span`으로 크기를 타입/객체에 붙여 다닌다. ④ `a[i] == *(a+i)`, 즉 인덱싱 자체가 포인터 산술의 설탕이라는 것까지 말하면 상급이다.
:::

### 경계 검사는 없다

`a[i]`가 그냥 주소 덧셈이라는 사실의 어두운 면이다. 덧셈에는 한계가 없다 — **범위 검사가 존재하지 않는다.**

```cpp title="oob.cpp — 마지막 유효 인덱스는 2다"
#include <iostream>

int main() {
    int gains[3] = {100, 200, 300};
    int idx = 3;                      // 마지막 유효 인덱스는 2
    std::cout << gains[idx] << "\n";  // 범위 밖: UB
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra oob.cpp -o oob
$ ./oob
827008256
```

경고 없이 컴파일됐고(인덱스가 변수라 컴파일러가 추적하지 못했다 — 상수 인덱스면 `-Warray-bounds`가 잡기도 한다), 크래시도 없이 쓰레기값이 나왔다. `gains[3]`은 배열 바로 뒤의 스택 바이트 4개를 int로 읽은 것이다. 이 값은 이 실행에서 이렇게 나왔을 뿐, 아무 보장이 없다 — [1.2](#/types)에서 만난 **미정의 동작**이고, 다음 실행에서는 0이, 릴리스 빌드에서는 크래시가 나와도 계약 위반은 코드 쪽이다. 게인 배열을 잘못 읽은 제어기가 임의의 게인으로 모터를 돌리는 것이 이 한 줄의 실전 의미다.

이런 버그를 잡는 도구가 AddressSanitizer(ASan)다. 컴파일 플래그 하나로 켠다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address oob.cpp -o oob_asan
$ ./oob_asan
==27695==ERROR: AddressSanitizer: stack-buffer-overflow on address 0x7f283e10002c ...
READ of size 4 at 0x7f283e10002c thread T0
    #0 0x55a99498a3f5 in main oob.cpp:6
  This frame has 1 object(s):
    [32, 44) 'gains' (line 4) <== Memory access at offset 44 overflows this variable
(이하 생략)
```

리포트가 사고 경위서 수준이다: 종류(**stack-buffer-overflow**), 행위(4바이트 **READ**), 위치(`oob.cpp:6`), 피해자(`gains`, 4번 줄 선언)까지 짚는다. 새니타이저의 원리와 종류별 사용법은 [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 정면으로 다룬다 — 지금은 습관 하나만 가져가라. **배열을 만지는 코드를 짰으면 ASan 빌드로 한 번 돌린다.**

C 배열의 불구는 하나 더 있다. 대입이 안 된다.

```console
$ g++ -std=c++20 -Wall -Wextra copyarr.cpp
copyarr.cpp:4:7: error: invalid array assignment
```

`int b[3]; b = a;`는 에러다. 복사도, `==` 비교도, 함수에서 값으로 반환도 안 된다. 크기를 잊고, 경계를 모르고, 복사도 못 하는 이 타입을 현대 C++이 어떻게 수선했는가.

## std::array: 배열이 잊는 것을 타입이 기억한다

`std::array<T, N>`은 크기 `N`이 **타입의 일부**다. `std::array<double, 6>`과 `std::array<double, 3>`은 서로 다른 타입이라 섞어 넘길 수 없다 — 크기 검사가 컴파일 타임으로 옮겨온다.

```cpp title="stdarr.cpp — 크기가 함수 경계를 넘는다"
#include <array>
#include <iostream>

void print_all(const std::array<double, 6>& joints) {
    std::cout << "sizeof (함수 안) = " << sizeof(joints) << "\n";
    std::cout << "size()           = " << joints.size() << "\n";
}

int main() {
    std::array<double, 6> joints{0.1, 0.2, 0.3, 0.4, 0.5, 0.6};
    std::cout << "sizeof (main)    = " << sizeof(joints) << "\n";
    print_all(joints);

    try {
        double v = joints.at(6);      // 범위 밖: 예외
        std::cout << v << "\n";
    } catch (const std::out_of_range& e) {
        std::cout << "예외: " << e.what() << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra stdarr.cpp -o stdarr
$ ./stdarr
sizeof (main)    = 48
sizeof (함수 안) = 48
size()           = 6
예외: array::at: __n (which is 6) >= _Nm (which is 6)
```

세 가지가 한 번에 확인된다. `sizeof`가 함수 안에서도 48 — 붕괴가 없다. `size()`가 6을 안다. 그리고 `.at(6)`은 쓰레기값 대신 `std::out_of_range` **예외**를 던진다 — 범위 밖 접근이 UB에서 "잡을 수 있는 사건"으로 바뀌었다.

비용은 얼마인가. **0이다.** `sizeof(std::array<double, 6>)` = 48로 C 배열과 정확히 같다 — 내부가 C 배열 하나뿐인 구조체이고, 크기 `N`은 데이터가 아니라 타입에 있어서 메모리를 차지하지 않는다. C++의 제로 오버헤드 원칙이 교과서적으로 구현된 타입이다. 복사와 비교도 그냥 된다:

```cpp title="copyarr2.cpp — 조각: 핵심만"
std::array<int, 3> a{1, 2, 3};
std::array<int, 3> b = a;      // ✅ 값 복사
b[0] = 99;
std::cout << a[0] << " " << b[0] << "\n";          // 1 99  <- 독립 사본
std::cout << std::boolalpha << (a == b) << "\n";   // false <- 요소 단위 비교
```

값 복사가 되므로 [1.6](#/functions)의 인자 전달 규칙이 그대로 적용된다 — 48바이트짜리를 읽기만 하는 함수에는 위 코드처럼 `const&`로 넘긴다.

로봇 도메인에서 이 타입의 자리는 명확하다. **크기가 데이터의 계약인 것은 전부 `std::array`다.** 6축 팔의 관절 각도는 `std::array<double, 6>`, 헥사포드 다리 하나의 관절은 `std::array<double, 3>`, 쿼터니언은 `std::array<double, 4>`. 관절이 실행 중에 늘어나는 로봇은 없다 — 그 불변의 사실을 타입에 새기면, 각도 5개만 채운 버그가 런타임 쓰레기값이 아니라 컴파일 에러나 `.at()` 예외로 바뀐다. [1.2](#/types)에서 `uint8_t`가 레지스터 폭이라는 계약을 타입에 새겼던 것과 같은 원리다. 반대로 실행 중 크기가 변하는 데이터 — 포인트 목록, 탐지된 장애물 — 는 [5.1 vector](#/vector)의 몫이다.

::: tip operator[]는 std::array에서도 무검사다
검사는 `.at()`만 한다. `joints[6]`은 C 배열과 똑같이 UB다 — `std::array`를 썼다고 경계 검사가 공짜로 따라오는 게 아니다. 실무 균형은 이렇다: 핫 루프에서는 `[]`를 쓰되(검사 분기 비용 0), 테스트를 ASan 빌드로 돌려 범위 밖 접근을 개발 중에 잡는다. `.at()`은 인덱스가 외부 입력(파라미터 파일, 네트워크)에서 오는 경계 지점에 쓴다.
:::

## C 문자열: 0이 나올 때까지

문자열로 넘어간다. C의 문자열은 별도 타입이 아니다 — **char 배열 + "값 0인 문자(`'\0'`)가 끝 표시"라는 관례**다. 그래서 배열의 모든 성질(붕괴, 무경계, 연속 메모리)을 그대로 물려받는다. 리터럴부터 해부한다.

```cpp title="cstr.cpp — 리터럴의 정체"
#include <cstring>
#include <iostream>
#include <type_traits>

int main() {
    std::cout << std::boolalpha;
    std::cout << "type is const char[6]? "
              << std::is_same_v<decltype("hello"), const char(&)[6]> << "\n";
    std::cout << "sizeof(\"hello\") = " << sizeof("hello") << "\n";
    std::cout << "strlen(\"hello\") = " << std::strlen("hello") << "\n";

    char buf[] = "hi";                // 리터럴을 배열로 복사 (붕괴 아님)
    std::cout << "sizeof(buf)     = " << sizeof(buf) << "\n";
    for (int i = 0; i < 3; ++i)
        std::cout << "buf[" << i << "] = " << static_cast<int>(buf[i]) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra cstr.cpp -o cstr
$ ./cstr
type is const char[6]? true
sizeof("hello") = 6
strlen("hello") = 5
sizeof(buf)     = 3
buf[0] = 104
buf[1] = 105
buf[2] = 0
```

`"hello"`의 타입은 `const char[6]` — 문자 다섯에 종단 `'\0'` 하나가 붙어 여섯이다. `sizeof`는 종단 포함 6, `strlen`은 종단 전까지 세서 5. `buf`의 덤프가 관례의 실물이다: `'h'`(104), `'i'`(105), 그리고 0. 이 0이 없으면 `strlen`도 `std::cout <<`도 배열 끝을 지나 0이 나올 때까지 남의 메모리를 계속 읽는다 — 위 `oob.cpp`와 같은 UB다.

`const`에 주의하라. 리터럴은 읽기 전용 영역에 놓이며, 수정은 UB다. 리터럴을 가리키는 포인터는 반드시 `const char*`로 받는다. `char* p = "hi";`는 C++11부터 표준이 금지한 변환인데, g++ 13.3은 기본 설정에서 에러 대신 `ISO C++ forbids converting a string constant to 'char*' [-Wwrite-strings]` 경고를 낸다(실측 — `-pedantic-errors`를 붙이면 에러가 된다). 경고든 에러든 결론은 같다 — 리터럴에는 `const`를 붙여 받아라.

::: hist 왜 하필 널 종단인가
문자열 표현은 두 계보가 있다. 길이를 앞에 저장하는 방식(파스칼 문자열)과, 끝에 표시 문자를 두는 방식(C). C가 태어난 PDP-11 시절, 길이 필드는 최소 1~2바이트를 먹고 표현 가능한 길이에 상한을 만들었다 — 종단 문자는 딱 1바이트에 길이 무제한이었고, 당시 어셈블리의 문자열 처리 관행과도 맞았다. 그 대가가 50년 뒤에도 남았다: 길이를 **저장하지 않으므로** 물을 때마다 O(n)으로 세야 하고, 종단 하나가 빠지면 곧장 버퍼 오버런이다. `std::string`은 두 계보 중 파스칼 쪽으로 돌아간 설계다 — 길이를 저장하고, O(1)로 답한다.
:::

`strlen`이 정말 끝까지 걸어가는지, 걸어가는 비용이 얼마인지 실측한다.

::: perf strlen은 길이에 정직하게 비례한다
1KB 문자열과 1MB 문자열에 `strlen`을 10,000번씩 호출했다 (g++ 13.3 / -O2 / Linux x86-64 실측, 절대값은 기기마다 다르다):

```console
$ ./strlen_cost
strlen 1KB   x 10000 =       94 us
strlen 1MB   x 10000 =   110003 us
string.size x 10000 =        4 us
```

길이가 1,000배가 되니 시간도 약 1,170배 — 선형 그 자체다. 반면 `std::string::size()`는 저장된 값을 읽기만 해서 문자열이 1MB든 1GB든 상수 시간이다. 실전 규칙: **루프 조건에 `strlen`을 넣지 마라.** `for (size_t i = 0; i < strlen(s); ++i)`는 매 반복마다 문자열 전체를 다시 세는 $O(n^2)$ 루프다. C 문자열을 받았으면 길이를 한 번 재서 변수로 들고 다녀라.
:::

## std::string: 길이를 아는 문자열

`std::string`은 파스칼 계보의 현대적 구현이다. 이 환경 실측으로 `sizeof(std::string)` = 32 — 본질은 세 필드짜리 작은 구조체다.

```text nolines
std::string (libstdc++, 32 bytes, measured)

  +-----------+-----------+------------------------------+
  | char* ptr | size_t sz | union { size_t cap; buf[16] } |
  +-----------+-----------+------------------------------+
       |
       v
  "the actual characters live here (usually heap)"
```

문자들의 소유권을 이 세 워드가 관리한다 — 포인터가 어디를 가리키고, 소멸 시 누가 해제하고, 대입 시 무엇이 복사되는가는 Part II 전체의 주제이고, 특히 이 ptr/size/capacity 삼총사가 통째로 "이사"하는 장면을 [2.7 이동 시맨틱](#/move-semantics)에서 위젯으로 본다. 이 절에서는 배열/문자열 관점에서 두 가지만 실측한다: 짧은 문자열의 특별 취급과, `+=`의 재할당.

### SSO: 짧은 문자열은 힙에 가지 않는다

위 그림의 union이 힌트다. 문자들이 항상 힙에 있는 게 아니다 — **충분히 짧으면 32바이트 객체 안의 내장 버퍼에 직접 저장된다.** 이것이 SSO(Small String Optimization)다. 확인 기법: `data()`가 돌려주는 주소가 객체 자신(`&s`부터 32바이트 안)을 가리키면 내장 버퍼, 밖이면 힙이다.

```cpp title="sso.cpp — 조각: 판정 함수"
bool on_stack(const std::string& s) {
    const char* obj  = reinterpret_cast<const char*>(&s);
    const char* data = s.data();
    return data >= obj && data < obj + sizeof(s);
}
```

```console
$ ./sso
sizeof(std::string) = 32

len cap  buffer
 0  15  객체 내부 (SSO)
 8  15  객체 내부 (SSO)
15  15  객체 내부 (SSO)
16  16  힙
31  31  힙
100  100  힙
```

(중간 길이 행은 생략했다 — 판정은 전부 같은 패턴이다.)

경계는 **15자**다(libstdc++). 15자까지는 capacity가 15에 고정이고 버퍼가 객체 내부 — 힙 할당이 0회다. 16자부터 힙으로 나간다. 정말 0회인지 전역 `operator new`를 가로채 할당 횟수를 직접 셌다:

```console
$ ./allocs
"base_link" (9자)       : 할당 0회
28자 프레임 이름        : 할당 1회
루프 1000회 문자열 조립 : 할당 1000회
```

`"base_link"` 같은 9자짜리는 `std::string`을 만들어도 힙을 건드리지 않는다. 28자짜리 프레임 이름은 생성마다 할당 1회. 그리고 루프에서 문자열을 조립하면 **반복 횟수만큼 할당**이 쌓인다 — 마지막 줄의 의미는 아래 로봇 이야기에서 잇는다.

::: deep 15자는 어디서 왔고, 왜 믿으면 안 되는가
libstdc++의 32바이트는 ptr 8 + size 8 + union 16으로 쪼개진다. union 자리는 힙 모드에서는 capacity(8바이트)로, SSO 모드에서는 16바이트 문자 버퍼로 쓰인다 — 종단 `'\0'` 한 자리를 빼면 15자다. 그런데 libc++(clang의 표준 라이브러리)는 객체가 24바이트로 더 작은데도 필드를 다르게 접어 **22자**까지 SSO로 담는다. SSO의 존재도 경계도 표준이 아니라 구현의 선택이다 — 표준이 요구하는 것은 인터페이스와 복잡도뿐이다. "15자 이하니까 할당 없음"은 이 환경의 사실이지 이식 가능한 계약이 아니다. 코드가 특정 경계값에 의존하게 하지 마라.
:::

### += 는 재할당한다

문자열이 자라면 어떻게 되는가. 한 글자씩 200번 붙이며 capacity가 바뀌는 순간만 찍었다.

```console
$ ./grow
len 0: cap 15
len 16: cap 30 <- 재할당
len 31: cap 60 <- 재할당
len 61: cap 120 <- 재할당
len 121: cap 240 <- 재할당
```

15 → 30 → 60 → 120 → 240 — **2배 성장**이다(libstdc++ 실측). 재할당 한 번의 실체는: 새 힙 블록 할당, 기존 문자 전부 복사, 이전 블록 해제. 그 순간 문자들의 주소가 전부 바뀌므로, 재할당 전에 받아 둔 `data()` 포인터는 죽은 주소가 된다 — 댕글링 포인터의 전형이고 [2.11](#/ub-sanitizers)의 주제다. 이 성장 전략과 무효화 이야기는 `vector`에서 정확히 반복된다([5.1](#/vector)) — string은 char 전용 vector라고 봐도 이 절에서는 무방하다.

::: note tf2의 프레임 이름이 전부 이 이야기다
ROS 2에서 좌표 프레임은 문자열로 식별된다 — `lookupTransform("odom", "leg_front_left/tibia_link", ...)` 처럼 `std::string`이 API를 타고 흐른다([10.7 tf2](#/tf2)). 위 실측을 대입해 보라. `"base_link"`(9자)는 SSO 덕에 무할당이지만, 헥사포드 다리처럼 계층적 이름을 쓰면 프레임 이름 하나가 쉽게 16자를 넘고, 그 문자열을 만드는 자리마다 힙 할당이 붙는다. 특히 1 kHz 제어 루프 안에서 매 주기 이름을 조립하면(위 실측의 루프가 정확히 그 시뮬레이션이다 — `std::string("leg_front_left/") + "tibia_" + std::to_string(i)`) **초당 1,000회 힙 할당**이다. 조립 결과가 15자 이하로 짧으면 SSO 덕에 0회가 되기도 한다는 것까지 실측했지만, 그 우연에 실시간성을 걸 수는 없다. 힙 할당은 소요 시간의 상한이 없어 실시간 루프의 금기다 — 이유는 [6.8 실시간 제약과 제어 루프](#/realtime)에서 실측으로 다룬다. 처방의 방향만 미리: 프레임 이름·토픽 이름 문자열은 초기화 시점에 만들어 멤버로 들고, 루프 안에서는 재사용한다.
:::

## 리터럴 둘은 더할 수 없다

`std::string`에 익숙해지기 전에 전원이 밟는 지뢰다. 프레임 이름을 조립해 보자.

```cpp title="cat1.cpp — 조각: 핵심 한 줄"
std::cout << "base" + "_link";   // ❌
```

```console
$ g++ -std=c++20 -Wall -Wextra cat1.cpp -o cat1
cat1.cpp:4:25: error: invalid operands of types 'const char [5]' and 'const char [6]' to binary 'operator+'
```

에러 메시지가 이 절 전체의 복습이다 — 리터럴의 타입은 `const char[N]` **배열**이고, 배열에는 `operator+`가 없다. 포인터로 붕괴해도 포인터 + 포인터는 정의되지 않은 연산이라 역시 에러다. 컴파일이 막히니 차라리 다행이고, 진짜 함정은 이쪽이다:

```cpp title="cat2.cpp — 조각: 핵심 한 줄"
std::cout << "base_link" + 5;    // 컴파일된다. 연결이 아니다
```

```console
$ ./cat2
link
```

**에러도 경고도 없이 `link`가 나왔다.** `"base_link" + 5`는 붕괴한 `const char*`에 정수를 더한 것 — 이 절 앞부분에서 배운 포인터 산술 그대로, 6번째 문자부터 시작하는 포인터다. "연결했다"고 믿은 문자열이 조용히 꼬리만 남는다. `"error code: " + err` 같은 로그 코드에서 실제로 터지는 패턴이다.

올바른 연결은 셋 중 하나다.

```cpp title="cat3.cpp — 조각: 세 가지 처방"
using namespace std::string_literals;

std::string a = std::string("base") + "_link";  // ✅ 한쪽이 string이면 연쇄가 붙는다
std::string b = "base"s + "_link";              // ✅ "..."s 는 std::string 리터럴
std::string c = "base" "_link";                 // ✅ 인접 리터럴은 컴파일 타임에 이어붙는다
```

①과 ②는 같은 원리다 — `std::string`의 `operator+`는 `+`가 왼쪽부터 결합하므로, 식의 왼쪽 어딘가에 `string`이 하나 있으면 이후 연쇄 전체가 `string` 연결이 된다. `"..."s` 접미사(`std::string_literals`)는 [1.2](#/types)의 리터럴 접미사와 같은 문법으로 그 "하나"를 가장 짧게 만드는 방법이다. ③은 연산이 아니라 문법이다 — 공백으로 나란히 놓인 리터럴을 컴파일러가 한 리터럴로 합친다. 긴 도움말 텍스트를 소스에서 여러 줄로 쪼갤 때 쓴다.

## 소유하지 않는 문자열: string_view 예고

이 절이 남긴 숙제가 하나 있다. 함수가 문자열을 읽기만 할 때 `const std::string&`으로 받으면, 호출자가 리터럴을 넘기는 순간 임시 `std::string`이 생성된다 — 16자를 넘으면 힙 할당까지 붙는, 읽기 한 번 치고 비싼 비용이다. C++17의 `std::string_view`는 이 절에서 배운 재료 딱 두 개 — **포인터 + 길이** — 만 들고 다니는 소유하지 않는 읽기 전용 뷰로 이 문제를 끝낸다. 리터럴이든 `string`이든 char 배열이든 복사·할당 없이 감싼다. 대신 "소유하지 않는다"가 만드는 수명 함정이 있고, 그 전모는 [5.8 string_view와 span](#/views)에서 다룬다.

## 요약

- 함수 파라미터의 배열 선언은 포인터다 — `sizeof` 48 → 8 실측, `-Wsizeof-array-argument` 경고. 크기는 함수 경계에서 증발하므로 별도로 전달되거나 타입에 있어야 한다.
- 배열은 연속 메모리이고 `a[i]`는 `*(a+i)`의 설탕이다 — 주소가 `sizeof(int)`씩 증가하는 것, `a[2] == *(a+2)`, `2[a]`까지 실측. 붕괴의 예외는 `sizeof`, 단항 `&`, `decltype`, 배열 참조 바인딩.
- 경계 검사는 없다 — `gains[3]`은 조용히 쓰레기값(UB)이고, ASan이 `stack-buffer-overflow`로 파일·줄·배열 이름까지 짚는다 — [2.11](#/ub-sanitizers).
- `std::array<T, N>`은 오버헤드 0(sizeof 48 = C 배열)으로 크기 보존·값 복사·비교·`.at()` 예외를 준다. **크기가 계약인 데이터(관절 각도 `std::array<double, 6>`)의 기본 선택.** 단 `[]`는 여전히 무검사다.
- C 문자열은 `'\0'` 종단 관례다. `"hello"`는 `const char[6]`(종단 포함), `strlen`은 O(n) — 1MB에서 1KB의 약 1,170배 실측. 루프 조건에 `strlen` 금지.
- `std::string`은 ptr/size/capacity 32바이트 구조로 `size()`가 O(1)이다. SSO 실측: 15자까지 힙 할당 0회(libstdc++, 구현 정의 — libc++는 22자), 16자부터 힙. `+=`는 15→30→60→120 2배 성장으로 재할당하며 기존 `data()` 포인터를 무효화한다.
- 리터럴 + 리터럴은 컴파일 에러, 리터럴 + 정수는 포인터 산술이다 — `"base_link" + 5`가 `link`를 내는 것을 실측했다. 연결은 `"..."s`나 `std::string` 경유로.
- 실시간 루프 안의 문자열 조립은 초당 수천 회 힙 할당이다 — 프레임/토픽 이름은 루프 밖에서 만들어 재사용한다 — [6.8](#/realtime).

::: quiz 연습문제
1~3번은 예측·개념 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. 다음 함수 안의 출력을 **컴파일하지 말고** 예측하고, 근거를 한 문장으로 써라.

   ```cpp
   void handle(char msg[256]) {
       std::cout << sizeof(msg) << " " << sizeof(msg[0]);
   }
   ```

2. `for (std::size_t i = 0; i < std::strlen(s); ++i)` 루프의 시간 복잡도는 무엇인가. 이 절의 실측 수치 하나를 근거로 대고, 복잡도를 $O(n)$으로 만드는 방법을 두 가지 말하라.

3. 위젯의 `p = arr + 4` 버튼은 합법인데 그 자리의 `*p`는 UB다. one-past-end 포인터가 왜 "만들기까지는" 합법으로 정의됐는지, 반복 종료 조건과 연결해 설명하라.

4. (실습) ASan으로 범위 밖 접근 잡기: `double waypoints[8]`을 선언하고 인덱스 8에 **쓰기**를 하는 프로그램을 작성해, 먼저 ASan 없이 실행해 보고(무슨 일이 나는가?), 그다음 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address`로 다시 빌드해 실행하라. 성공 기준: 리포트에서 ① 종류가 `stack-buffer-overflow`인 것 ② `WRITE of size 8`인 것 ③ `'waypoints'`와 네 소스의 줄 번호를 찾아 말할 수 있다.

5. (실습) SSO 경계 찾기: 본문의 `on_stack` 판정 함수를 직접 치고, 길이 1부터 30까지의 문자열을 만들어 `capacity()`와 판정 결과를 표로 출력하라. 성공 기준: 네 환경의 SSO 경계 길이와 `sizeof(std::string)`을 보고할 수 있고, 경계 직전/직후에서 capacity가 어떻게 변하는지 설명할 수 있다. (libstdc++이면 본문과 같은 15가 나와야 정상이다.)
:::

::: answer 해설
1. `8 1`이 나온다. 파라미터 자리의 `char msg[256]`은 `char* msg`의 표기 변형이므로 `sizeof(msg)`는 포인터 크기 8이고, `msg[0]`은 `char`라 1이다. 256은 컴파일러가 읽고 버리는 주석이다 — g++ 13.3은 `-Wsizeof-array-argument` 경고까지 준다.
2. $O(n^2)$이다. `strlen`이 매 반복마다 종단까지 다시 세기 때문 — 실측에서 `strlen`은 1KB 대비 1MB에서 약 1,170배 느렸다(선형). 처방 ① 루프 전에 `const std::size_t n = std::strlen(s);`로 한 번만 재서 조건에 `i < n`을 쓴다. ② 애초에 길이를 저장하는 `std::string`(또는 `std::string_view`)으로 받아 `size()`(O(1), 실측 10,000회에 4us)를 쓴다.
3. 포인터 반복의 관용구 `for (int* p = arr; p != arr + 4; ++p)`가 성립하려면 마지막 요소에서 `++p`를 한 결과, 즉 배열 바로 다음 주소가 **유효한 포인터 값**이어야 한다(비교에 쓸 수 있어야 한다). 그래서 표준은 one-past-end까지의 포인터 산술과 비교를 합법으로 정의했다 — 단 그 자리에는 요소가 없으므로 역참조는 UB다. "가리키는 것"과 "읽는 것"이 별개 행위라는 포인터의 본질이 여기 압축돼 있다.
4. ASan 없는 실행은 아무 티도 안 날 확률이 높다 — 스택의 이웃 바이트를 조용히 덮어쓰는 것이라 쓰레기값 출력조차 없다(그래서 읽기보다 위험하다). ASan 빌드는 본문 리포트와 같은 형식으로 `WRITE of size 8`, `'waypoints'`, 소스 줄 번호를 짚는다. `double`이라 8바이트 WRITE인 것까지 확인하면 리포트를 제대로 읽은 것이다.
5. libstdc++(g++) 기준 실측: `sizeof(std::string)` = 32, 길이 15까지 capacity 15 + 객체 내부, 16부터 capacity가 길이와 같아지며 힙으로 나간다. libc++(clang)에서는 경계가 22다. 이 실습의 목적은 경계값 암기가 아니라 **`data()` 주소로 저장 위치를 판정하는 기법**과, SSO가 구현 정의라는 사실을 손으로 확인하는 것이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `decay.cpp` → `walk.cpp` → `oob.cpp` 세 개는 순서대로 — 크기 증발, 주소 걷기, 경계 없음이 하나의 이야기다. `oob.cpp`는 반드시 ASan 버전까지 돌려 리포트를 소리 내 읽어라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`, 벤치마크(`strlen_cost.cpp`)만 `-O2`를 붙인다.

**다음 절**: [1.8 구조체와 열거형](#/structs-enums) — 같은 타입 여러 개를 묶는 법을 배웠으니, 이제 **다른 타입들**을 하나로 묶는다. 집성체 초기화의 규칙과 `enum class`가 낡은 `enum`을 대체한 이유까지.

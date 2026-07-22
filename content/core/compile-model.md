# 1.1 컴파일 모델: 전처리 → 컴파일 → 링크

::: lead
[0.3](#/first-build)에서 당신은 이상한 실패를 봤다. 문법은 완벽한데 빌드가 깨졌고, 에러를 뱉은 것은 컴파일러가 아니라 `ld`라는 낯선 프로그램이었다. "컴파일은 됐는데 왜 실패하나" — 이 질문에 답하려면 `g++` 한 줄이 실제로는 **네 단계의 파이프라인**이라는 것을 알아야 한다. 이 절에서는 각 단계를 `-E`, `-S`, `-c`, `nm`으로 직접 열어 본다. 이 모델이 머리에 있으면 C++의 많은 규칙 — 왜 선언이 필요한가, 왜 헤더 가드를 쓰는가, 왜 라이브러리를 "링크"하는가 — 이 규칙이 아니라 필연으로 보이기 시작한다.
:::

## 컴파일은 됐는데 왜 실패하는가

0.3의 깨뜨리기 4를 다시 보자. 선언만 있고 정의가 없는 함수를 호출했을 때, 에러는 이렇게 생겼었다.

```console
$ g++ -std=c++20 -Wall -Wextra main.cpp -o calc
/usr/bin/ld: /tmp/ccVHXQvp.o: in function `main':
main.cpp:(.text+0x13): undefined reference to `add(int, int)'
collect2: error: ld returned 1 exit status
```

이 출력에는 이미 단서가 두 개 박혀 있다. 첫째, 말하는 주체가 `/usr/bin/ld`다 — `g++`가 아닌 다른 프로그램이 일하다가 실패했다. 둘째, `/tmp/ccVHXQvp.o`라는 임시 파일이 등장한다 — 우리가 만든 적 없는 `.o` 파일이 어딘가에서 생겨났다.

둘 다 같은 사실을 가리킨다. **`g++`는 컴파일러가 아니라 드라이버(driver)다.** 당신이 `g++ main.cpp -o calc`를 치면 g++는 뒤에서 네 개의 단계를 순서대로 지휘한다.

1. **전처리(preprocess)** — `#include`, `#define` 같은 `#` 지시문을 처리해 순수한 C++ 소스를 만든다.
2. **컴파일(compile)** — C++ 소스를 어셈블리 코드로 번역한다.
3. **어셈블(assemble)** — 어셈블리를 기계어로 바꿔 오브젝트 파일(`.o`)을 만든다.
4. **링크(link)** — 오브젝트 파일들과 라이브러리를 묶어 실행파일을 만든다.

각 단계의 산출물은 평소엔 임시 파일로 만들어졌다 지워지는데, `--save-temps`를 주면 전부 남는다. 실측해 보자.

```console
$ g++ -std=c++20 --save-temps hello.cpp -o hello
$ ls -la hello.ii hello.s hello.o hello
-rwxr-xr-x 1 root root   16352 hello
-rw-r--r-- 1 root root 1095578 hello.ii
-rw-r--r-- 1 root root    1896 hello.o
-rw-r--r-- 1 root root    1408 hello.s
```

(이 절의 모든 출력은 g++ 13.3 / Ubuntu 24.04 x86-64 실측이다. 줄 수와 바이트 수는 표준 라이브러리 버전에 따라 달라지지만 자릿수의 그림은 같다.)

85바이트짜리 `hello.cpp`가 전처리를 거치면 **1,095,578바이트**(`hello.ii`)로 부풀고, 컴파일을 거치면 1,408바이트(`hello.s`)로 줄어들고, 어셈블 후 1,896바이트(`hello.o`), 링크 후 16,352바이트(`hello`)가 된다. 만 배로 부풀었다 줄어드는 이 궤적 자체가 각 단계의 성격을 말해 준다. 이제 하나씩 연다.

## 1단계 — 전처리: 텍스트를 이어 붙이는 가위질

전처리기(preprocessor)는 C++를 모른다. 타입도, 함수도, 문법도 모른다. 아는 것은 `#`으로 시작하는 지시문과 **텍스트**뿐이다. `-E` 플래그는 전처리만 하고 결과를 표준 출력으로 뱉으라는 뜻이다.

```console
$ wc -l hello.cpp
6 hello.cpp
$ g++ -E hello.cpp | wc -l
36588
```

6줄이 **36,588줄**이 됐다. `#include <iostream>`은 마법의 주문이 아니라 **복사-붙여넣기 명령**이기 때문이다. 전처리기는 `/usr/include/c++/13/iostream` 파일을 찾아 그 내용을 그 자리에 통째로 붙여 넣는데, 그 파일이 또 다른 파일들을 include하고, 그것들이 또 include한다. 연쇄가 끝나면 `<iostream>` 한 줄 자리에 표준 라이브러리 선언 수만 줄이 들어와 있다. 출력의 끝부분을 보면 우리가 쓴 코드는 꼬리 5줄이 전부다.

```console
$ g++ -E hello.cpp | tail -6
# 3 "hello.cpp"
int main() {
    std::cout << "hello, robot\n";
    return 0;
}
```

이것이 다음 단계(컴파일러)가 실제로 받는 입력이다. 컴파일러 입장에서 `#include` 같은 것은 애초에 존재한 적이 없다 — 그저 아주 긴 소스 파일 하나가 있을 뿐이다. 0.3에서 include를 지웠을 때 `'cout' is not a member of 'std'`가 났던 이유가 이제 기계적으로 설명된다. 붙여넣기가 없었으니 `std::cout`의 선언이 파일 안에 문자 그대로 없는 것이다.

::: note `# 36588` 같은 줄은 뭔가
`-E` 출력 곳곳에 있는 `# 306 "/usr/include/.../c++config.h" 3` 형태의 줄은 줄 마커(line marker)다. "지금부터 나오는 내용은 원래 저 파일의 저 줄에서 왔다"는 기록이고, 컴파일러가 에러를 낼 때 부풀린 파일이 아니라 **원본 파일:줄**을 지목할 수 있는 것이 이 덕분이다. 에러 메시지의 `파일:줄:칸`은 전처리기가 남긴 이 이정표를 따라간 결과다.
:::

### #define은 무자비하다

`#define` 매크로도 같은 원리다 — 문법을 모르는 텍스트 치환. 그래서 위험하다. 실측한다.

```cpp title="macro.cpp"
#include <iostream>

#define SQUARE(x) x * x

int main() {
    std::cout << SQUARE(3) << "\n";
    std::cout << SQUARE(1 + 2) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra macro.cpp -o macro
$ ./macro
9
5
```

`SQUARE(1 + 2)`는 $3^2 = 9$여야 하는데 5가 나왔다. `-E`로 전처리기가 실제로 만든 코드를 보면 범인이 즉시 드러난다.

```console
$ g++ -E macro.cpp | tail -5
int main() {
    std::cout << 3 * 3 << "\n";
    std::cout << 1 + 2 * 1 + 2 << "\n";
    return 0;
}
```

`x` 자리에 `1 + 2`가 **글자 그대로** 박혀 `1 + 2 * 1 + 2`, 연산자 우선순위에 의해 $1 + 2 + 2 = 5$다. 전처리기는 "x는 하나의 값"이라는 개념 자체가 없다. 괄호로 감싸는 방어(`((x) * (x))`)가 관용구로 존재하지만, 근본 처방은 **함수가 되는 것은 함수로 쓰는 것**이다. 현대 C++에서 상수는 `constexpr` 변수로, 계산은 인라인 함수로 쓰고, 매크로는 조건부 컴파일 등 전처리 시점에만 가능한 일에 한정한다.

::: warn 매크로 버그는 컴파일러가 못 잡는다
위 코드는 `-Wall -Wextra`에서 경고 0개다. 치환이 끝난 `1 + 2 * 1 + 2`는 완벽하게 합법인 C++이기 때문에, 컴파일러 눈에는 아무 문제가 없다. 매크로 버그가 악질인 이유다 — 문제는 컴파일러가 보기 **전에** 일어나고, 에러 메시지에는 치환 결과만 나온다. 매크로가 의심되면 `g++ -E`로 치환 결과를 직접 보는 것이 가장 빠른 길이다.
:::

전처리가 "무지성 붙여넣기"라는 사실은 또 하나의 문제를 예고한다. 같은 헤더가 한 파일에 두 번 붙여넣기되면? 같은 선언이 두 번 나타나 에러가 된다. 이를 막는 장치가 헤더 가드이고, [1.9 헤더와 컴파일 단위](#/headers)에서 해부한다.

## 2단계 — 컴파일: 번역 단위 하나, 시야도 딱 그만큼

전처리가 끝난 소스 하나 — `.cpp` 파일 하나에 include된 헤더가 전부 풀려 들어간 덩어리 — 를 **번역 단위(translation unit)**라고 부른다. 컴파일러(협의의 컴파일)의 작업 단위가 정확히 이것이다. 컴파일러는 번역 단위 하나를 받아 어셈블리 코드로 번역하며, `-S` 플래그로 이 단계까지만 시킬 수 있다.

```cpp title="add.cpp"
int add(int a, int b) {
    return a + b;
}
```

```console
$ g++ -std=c++20 -S add.cpp -o add.s
$ wc -l add.s
42 add.s
```

3줄짜리 C++이 42줄의 어셈블리가 됐다. 핵심부만 발췌하면 이렇다 (최적화 없는 `-O0` 기준 실측).

```text nolines
_Z3addii:
        endbr64
        pushq   %rbp
        movq    %rsp, %rbp
        movl    %edi, -4(%rbp)      ; a
        movl    %esi, -8(%rbp)      ; b
        movl    -4(%rbp), %edx
        movl    -8(%rbp), %eax
        addl    %edx, %eax          ; a + b
        popq    %rbp
        ret
```

`return a + b`가 CPU 명령 몇 개로 번역된 모습이다. 그런데 함수 이름이 `add`가 아니라 `_Z3addii`다 — 이 이상한 이름은 3단계에서 정체를 밝힌다. 지금 붙잡아야 할 것은 다른 사실이다.

**컴파일러는 지금 처리 중인 번역 단위 바깥을 볼 수 없다.** `main.cpp`를 컴파일할 때 컴파일러는 `add.cpp`가 존재하는지조차 모른다. 같은 명령줄에 나란히 적어도 마찬가지다 — 번역 단위는 각각 독립적으로, 완전히 격리된 채 컴파일된다. 그런데 `main.cpp`는 `add(2, 3)`을 호출한다. 본 적 없는 함수의 호출 코드를 어떻게 만드는가?

여기가 선언이 존재하는 이유다. `int add(int a, int b);`라는 선언은 컴파일러에게 딱 필요한 만큼의 정보를 준다: 이름, 인자 타입들, 반환 타입. 이것만 있으면 "인자 2와 3을 규약에 맞는 레지스터에 넣고, `add`라는 이름의 주소로 점프하고, 반환값을 int로 받는" 코드를 생성할 수 있다. 그 이름이 실제로 어디 있는지는 몰라도 된다 — 그건 컴파일러의 일이 아니다. **선언은 번역 단위의 벽을 넘기 위한 약속이고, 약속만 믿고 코드를 만드는 것이 컴파일러의 설계다.** 이 문장이 이 절의 심장이다.

::: hist 왜 이렇게 설계됐나
"파일을 전부 같이 보면 되지 않나"라는 의문이 들 것이다. 이 모델은 1970년대 C에서 왔다. 당시 컴퓨터는 메모리가 수십 KB라 프로그램 전체를 한 번에 올릴 수 없었고, 파일 하나씩 컴파일해 결과를 이어 붙이는 분할 컴파일이 유일한 선택지였다. C++은 C의 도구 생태계를 그대로 물려받으며 이 모델도 물려받았다. 대가로 헤더·선언·ODR 같은 복잡성이 생겼지만, 덤으로 얻은 것이 **분리 빌드**다 — 바뀐 번역 단위만 다시 컴파일하는 것. 파일 수백 개짜리 프로젝트에서 이것이 3초와 20분의 차이를 만든다는 것은 0.3에서 봤다. C++20 모듈이 이 모델의 현대적 대안으로 표준에 들어왔지만, ROS 2를 포함한 실무 생태계는 여전히 이 고전 모델 위에 서 있다.
:::

::: deep 최적화하면 이 어셈블리가 아니다
위 발췌는 `-O0`(최적화 없음)의 산출물이라 스택에 값을 내렸다 올리는 군더더기가 많다. `-O2`를 주면 같은 함수가 `lea eax, [rdi+rsi]; ret` 두 줄 수준으로 줄어든다. 컴파일러가 최적화 레벨에 따라 실제로 어떤 코드를 만드는지 읽는 법은 [8.3 컴파일러 최적화와 코드 생성](#/codegen)에서 Compiler Explorer와 함께 본격적으로 다룬다.
:::

## 3단계 — 어셈블과 오브젝트 파일: 심볼 테이블

어셈블러는 어셈블리 텍스트를 기계어로 조립해 **오브젝트 파일(object file)** `.o`를 만든다. 0.3에서 이미 쓴 `-c` 플래그가 "여기까지만 하라"는 뜻이다. 오브젝트 파일은 기계어 덩어리이지만 아직 실행할 수 없다 — 다른 번역 단위로 점프하는 자리가 전부 "이름만 적힌 빈칸"으로 남아 있기 때문이다.

그 빈칸의 장부가 **심볼 테이블(symbol table)**이고, `nm`이라는 도구로 읽을 수 있다. 실측한다.

```console
$ g++ -std=c++20 -Wall -Wextra -c add.cpp main.cpp
$ nm add.o
0000000000000000 T _Z3addii
```

```console
$ nm main.o
                 U _Z3addii
                 U _ZNSolsEi
                 U _ZSt4cout
                 U _ZSt21ios_base_library_initv
                 U _ZStlsISt11char_traitsIcEERSt13basic_ostreamIcT_ES5_PKc
0000000000000000 T main
```

(가운데 `r` 심볼 몇 개는 지금 논의와 무관해 생략했다.) 읽는 법은 단순하다. 가운데 글자가 심볼의 종류다.

| 글자 | 뜻 | 읽는 법 |
| --- | --- | --- |
| `T` | Text(코드) 영역에 **정의가 있다** | "이 이름은 내가 갖고 있다" |
| `U` | Undefined — **정의가 없다** | "이 이름은 남이 줘야 한다" |

`add.o`는 말한다: "`_Z3addii`는 내가 갖고 있다(T)." `main.o`는 말한다: "`main`은 내가 갖고 있다(T). 그런데 `_Z3addii`와 `_ZSt4cout` 등은 남이 줘야 한다(U)." 컴파일러가 선언만 믿고 코드를 만들었다는 것의 물리적 실체가 바로 이 `U` 심볼이다 — 약속은 오브젝트 파일 안에 **외상 장부**로 남는다.

### _Z3addii — 이름 맹글링

심볼 이름이 `add`가 아니라 `_Z3addii`인 이유를 볼 차례다. 뜯어 보면 규칙이 보인다: `_Z`(C++ 심볼 표식) + `3add`(길이 3의 이름 add) + `ii`(int, int 인자). 함수의 이름에 **인자 타입 정보를 인코딩해 붙인 것**이고, 이를 이름 맹글링(name mangling)이라 한다. `nm -C`를 주면 사람이 읽는 형태로 되돌려(demangle) 보여 준다.

왜 이런 짓을 하는가. **오버로딩 때문이다.** 같은 이름의 함수를 인자 타입만 다르게 여럿 두는 것이 C++의 오버로딩인데, 링커의 세계에 "같은 이름의 심볼 두 개"란 있을 수 없다. 그래서 컴파일러는 타입 정보를 이름에 새겨 서로 다른 심볼로 만든다. 실측으로 확인한다.

```cpp title="overload.cpp"
int    add(int a, int b)       { return a + b; }
double add(double a, double b) { return a + b; }
```

```console
$ g++ -std=c++20 -Wall -Wextra -c overload.cpp
$ nm overload.o
0000000000000018 T _Z3adddd
0000000000000000 T _Z3addii
$ nm -C overload.o
0000000000000018 T add(double, double)
0000000000000000 T add(int, int)
```

소스에서 이름이 같던 두 함수가 심볼 수준에서는 `_Z3addii`와 `_Z3adddd`로 완전히 다른 존재다. **오버로딩은 언어 기능이기 이전에 맹글링이라는 구현 위에 서 있다.** 오버로드 중 어느 것이 선택되는가의 규칙은 [1.6 함수: 오버로딩과 인자 전달](#/functions)에서 다룬다.

::: tip 링커 에러의 심볼이 안 읽힐 때
링커 에러나 `nm` 출력에서 `_ZNSt6vectorIiSaIiEE9push_backEOi` 같은 암호문을 만나면 `nm -C`, 또는 `echo '심볼' | c++filt`로 복원하라. 방금 본 규칙 덕에 복원 결과에는 인자 타입까지 온전히 들어 있다 — "어느 오버로드가 없다는 것인지"까지 읽을 수 있다는 뜻이다.
:::

## 4단계 — 링크: 외상 장부 청산

이제 링커(`ld`)의 일이 정확히 한 문장으로 정의된다. **모든 오브젝트 파일과 라이브러리를 모아, 모든 `U`를 어딘가의 `T`와 짝지어라.** 이 과정을 심볼 해소(symbol resolution)라 한다. `main.o`의 `U _Z3addii`는 `add.o`의 `T _Z3addii`와 짝지어지고, `U _ZSt4cout`은 표준 라이브러리(libstdc++)가 제공한다. 모든 외상이 청산되면 호출 자리의 빈칸에 실제 주소가 채워지고 실행파일이 나온다.

```console
$ g++ main.o add.o -o calc
$ ./calc
5
```

그러면 0.3의 `undefined reference`가 무엇이었는지 한 층 아래에서 다시 보인다. `add.o`를 빼고 링크하면?

```console
$ g++ -std=c++20 -Wall -Wextra main.cpp -o calc
/usr/bin/ld: /tmp/ccVHXQvp.o: in function `main':
main.cpp:(.text+0x13): undefined reference to `add(int, int)'
collect2: error: ld returned 1 exit status
```

nm의 언어로 번역하면 이 메시지는 정확히 이것이다: "`main.cpp`의 오브젝트 파일에 `U _Z3addii`가 있는데, **주어진 어떤 파일에서도 `T _Z3addii`를 찾지 못했다.**" 문법의 문제가 아니라 장부 맞추기의 실패다. 그리고 에러에 줄 번호가 없던 이유도 이제 구조적으로 설명된다 — 링커가 보는 것은 심볼 테이블과 기계어이지 소스 코드가 아니다. `(.text+0x13)`은 "코드 영역의 0x13바이트 지점", 링커가 아는 가장 정밀한 주소다.

`T`가 없어서만 실패하는 것이 아니다. 같은 심볼의 `T`가 **두 개**여도 실패한다(`multiple definition`). 하나의 정의 규칙(ODR)이라 부르는 이 제약은 [1.10 네임스페이스와 링크리지](#/linkage)의 주제다.

정적 라이브러리(`.a` 파일)는 이 그림에 거의 아무것도 더하지 않는다 — `.o` 파일 여러 개를 `ar`이라는 도구로 묶은 보관함일 뿐이다. `-lfoo`로 라이브러리를 주면 링커는 그 보관함을 열어 미해소 `U`를 채워 주는 `.o`만 꺼내 쓴다. "라이브러리를 링크한다"는 말의 실체가 이것이다.

::: deep 실행파일에도 U가 남아 있다
링크가 끝난 `calc`에 `nm -C`를 대 보면 뜻밖의 것이 보인다.

```console
$ nm -C calc | grep ' U '
                 U std::ostream::operator<<(int)@GLIBCXX_3.4
                 U std::ios_base_library_init()@GLIBCXX_3.4.32
                 U std::basic_ostream<...>& std::operator<< <...>(...)@GLIBCXX_3.4
                 U __libc_start_main@GLIBC_2.34
```

`std::cout` 계열 심볼이 여전히 `U`다(실측, 일부 긴 심볼 축약). 표준 라이브러리는 기본적으로 동적 링크되기 때문이다 — 이 외상은 빌드 시점이 아니라 **프로그램을 실행하는 순간** 동적 링커가 `libstdc++.so`를 열어 청산한다. `@GLIBCXX_3.4` 꼬리표는 요구하는 라이브러리 버전이다. 다른 기계로 실행파일을 옮겼더니 `version GLIBCXX_x.y not found`가 나는 고전적 사고의 원인이 바로 이 지연된 장부다.
:::

::: interview "컴파일과 링크의 차이를 설명하라"
C++ 면접에서 가장 흔한 시작 질문 중 하나이고, 대답의 깊이로 연차가 드러난다. 뼈대: ① 컴파일은 **번역 단위 하나**를 독립적으로 기계어로 번역하는 단계다. 다른 번역 단위를 볼 수 없으므로 외부 이름은 선언만 믿고 코드를 생성하고, 그 이름들은 오브젝트 파일에 미해소 심볼(`U`)로 남는다. ② 링크는 오브젝트 파일과 라이브러리를 모아 **심볼을 해소**하는 단계다 — 모든 `U`에 정확히 하나의 정의(`T`)를 짝지어 주소를 채운다. ③ 그래서 에러의 성격이 다르다: 컴파일 에러는 "선언이 안 보인다"(헤더 누락, 오타), 링크 에러는 "정의가 없다/겹친다"(소스·라이브러리 누락, ODR 위반). 여기에 `nm`으로 `T`/`U`를 직접 확인해 진단한 경험, 맹글링이 오버로딩을 가능하게 한다는 것까지 얹으면 "도구를 열어 본 사람"이라는 신호가 된다.
:::

## 전체 그림

네 단계를 한 장에 모은다.

```text nolines
hello.cpp  (6 lines, 85 B)
    |
    |  (1) preprocess      g++ -E      #include paste, #define expand
    v
hello.ii   (36,588 lines, ~1.1 MB)     = translation unit
    |
    |  (2) compile         g++ -S      C++ -> assembly, one TU at a time
    v
hello.s    (1.4 KB)
    |
    |  (3) assemble        g++ -c      assembly -> machine code + symbols
    v
hello.o    (1.9 KB)        add.o           libstdc++
    |                        |                |
    +------------+-----------+----------------+
                 |
                 |  (4) link            ld    match every U with one T
                 v
              hello  (16 KB, executable)
```

단계를 아는 것의 실용적 가치는 **에러가 난 층을 즉시 판별하는 능력**이다. 세 층의 에러는 생김새부터 다르다. 전부 이 절과 0.3에서 실측한 것들이다.

| 단계 | 실측 예시 | 알아보는 법 |
| --- | --- | --- |
| 전처리 에러 | `broken.cpp:1:10: fatal error: imu_driver.h: No such file or directory` | `fatal error` + 파일을 못 찾았다는 내용. `compilation terminated.`로 즉사한다 |
| 컴파일 에러 | `hello.cpp:4:34: error: expected ';' before 'return'` | `파일:줄:칸: error:` 형식. 소스 줄 인용과 `^` 표시가 붙는다 |
| 링커 에러 | `/usr/bin/ld: ... undefined reference to 'add(int, int)'` | 말하는 주체가 `ld`. 줄 번호 대신 `(.text+0x13)`. 마지막 줄이 `collect2:` |

::: tip 에러를 보면 층부터 판별하라
층이 정해지면 볼 곳이 정해진다. 전처리 에러면 include 경로와 파일 이름을, 컴파일 에러면 지목된 소스(와 그 앞 줄)를, 링커 에러면 소스가 아니라 **빌드 명령**을 본다 — 어떤 `.cpp`나 라이브러리가 목록에서 빠졌는가. 링커 에러를 받고 소스 코드를 노려보는 것은 층을 잘못 짚은 것이고, 초심자가 시간을 가장 많이 버리는 지점이다.
:::

## colcon build는 이 파이프라인의 병렬 실행이다

이 지식이 로봇 개발에서 어디에 쓰이는가. ROS 2 워크스페이스에서 치는 `colcon build`는 새로운 빌드 시스템이 아니다. colcon은 패키지 의존성 순서를 계산해 패키지별로 CMake를 부르고, CMake는 결국 오늘 본 전처리→컴파일→어셈블을 소스 파일마다, 코어 수만큼 **병렬로** 돌린 뒤 링크한다. 빌드 로그에 `Building CXX object ...o`가 수십 줄 쏟아지다 `Linking CXX executable`이 한 번 나오는 리듬이 정확히 이 구조다.

그리고 ROS 2 초심자가 반드시 만나는 에러가 있다. `rclcpp::Node`를 상속한 코드가 컴파일은 다 되는데 마지막에 `undefined reference to 'rclcpp::Node::Node(...)'`로 죽는 경우 — CMakeLists.txt에서 `target_link_libraries`(또는 `ament_target_dependencies`)에 rclcpp를 빠뜨린 것이다. 이 절을 읽은 당신은 이 에러를 구조로 읽는다: 헤더는 include했으니 선언이 보여서 **컴파일은 통과**했고, rclcpp 라이브러리가 링크 목록에 없으니 `U`를 채울 `T`가 없어 **링크가 실패**했다. 처방은 소스가 아니라 CMakeLists.txt다. 타겟에 라이브러리를 붙이는 문법은 [7.1 CMake 기초](#/cmake-basics)에서, colcon과 ament의 전체 구조는 [10.10 ament, colcon, 패키지 구조](#/ament-colcon)에서 다룬다.

## 요약

- `g++`는 드라이버다. 뒤에서 **전처리 → 컴파일 → 어셈블 → 링크** 네 단계를 지휘하며, `--save-temps`로 각 산출물(`.ii`, `.s`, `.o`)을 볼 수 있다.
- 전처리는 문법을 모르는 텍스트 치환이다. `#include <iostream>` 한 줄이 36,588줄이 되고(실측), 매크로는 괄호 없이 쓰면 `1 + 2 * 1 + 2` 같은 코드를 만든다. 의심되면 `-E`로 치환 결과를 보라.
- 번역 단위 = `.cpp` 하나 + 풀려 들어간 헤더 전부. **컴파일러는 번역 단위 바깥을 못 본다 — 그래서 선언이 필요하다.** 선언만 믿고 호출 코드를 만드는 것이 설계다.
- 오브젝트 파일의 심볼 테이블은 `nm`으로 읽는다. `T`는 "정의를 갖고 있다", `U`는 "남이 줘야 한다"다.
- C++은 함수 이름에 인자 타입을 인코딩한다(맹글링, `_Z3addii`). 오버로딩은 이 구현 위에 서 있고, `nm -C`로 복원해 읽는다.
- 링크는 모든 `U`를 정확히 하나의 `T`와 짝짓는 일이다. `undefined reference` = "이 `U`를 채울 `T`가 어디에도 없다" — 처방은 소스가 아니라 빌드 명령(파일·라이브러리 목록)이다.
- 에러는 생김새로 층을 판별한다: `fatal error`(전처리) / `파일:줄:칸: error:`(컴파일) / `ld: ... undefined reference`(링크).
- `colcon build`는 이 파이프라인의 패키지 단위 병렬 실행이고, `target_link_libraries` 누락 에러는 이 절의 지식으로 바로 풀린다.

::: quiz 연습문제
1~2번은 개념, 3번은 판별 훈련, 4~5번은 **직접 파이프라인을 여는 실습**이다. 실습의 성공 기준은 네 컴퓨터의 출력이다.

1. `main.cpp`는 `int add(int, int);` 선언만 갖고 있는데도 `g++ -c main.cpp`가 성공한다. 컴파일러는 `add`의 몸체를 본 적이 없는데 어떻게 호출 코드를 만들 수 있는가? 그 대가로 `main.o`에 무엇이 남는가?

2. 아래는 두 오브젝트 파일의 `nm` 실측이다. 이 둘을 링크하면 성공하는가? 근거를 심볼 수준에서 대라.

   ```console
   $ nm motor.o
                    U _Z9clamp_pwmi
   0000000000000000 T main
   $ nm driver.o
   0000000000000000 T _Z9clamp_pwmd
   ```

3. 아래 세 에러는 각각 어느 단계(전처리/컴파일/링크)의 실패인가? 판별 근거를 하나씩 대라.

   ```text nolines
   (a) imu.cpp:1:10: fatal error: imu_driver.h: No such file or directory
   (b) /usr/bin/ld: node.o: undefined reference to `rclcpp::spin(...)'
   (c) imu.cpp:14:5: error: 'publish' was not declared in this scope
   ```

4. (실습) 아무 `.cpp`에 `#define SQUARE(x) x * x`와 `SQUARE(1 + 2)`를 넣고, 먼저 실행 결과를 예측한 뒤 `g++ -E 파일.cpp | tail -10`으로 치환 결과를 확인하라. 그다음 매크로를 `((x) * (x))`로 고쳐 `-E` 출력이 어떻게 달라지는지 보라. 성공 기준: 두 버전의 치환 결과 차이를 네 눈으로 확인한다.

5. (실습) `add.cpp`(정의)와 `main.cpp`(선언+호출)를 만들고 파이프라인을 손으로 돌려라: ① `g++ -std=c++20 -c add.cpp main.cpp` ② `nm add.o`와 `nm main.o`에서 `_Z3addii`가 각각 `T`/`U`로 나오는 것을 확인 ③ `g++ main.o add.o -o calc && ./calc` ④ `nm -C calc | grep add`로 링크 후 `T`가 된 것을 확인. 성공 기준: 같은 심볼이 `U`(main.o) → `T`(calc)로 바뀌는 것을 직접 본다.
:::

::: answer 해설
1. 선언이 이름·인자 타입·반환 타입을 알려 주므로, 호출 규약에 맞춰 인자를 배치하고 `_Z3addii`라는 이름으로 점프하는 코드는 몸체 없이도 만들 수 있다. 대가로 `main.o`의 심볼 테이블에 `U _Z3addii`(미해소 심볼)가 남고, 이 외상을 청산하는 것은 링커의 일이 된다.
2. **실패한다.** `motor.o`가 요구하는 것은 `_Z9clamp_pwmi` — 맹글링 꼬리 `i`, 즉 `clamp_pwm(int)`다. `driver.o`가 제공하는 것은 `_Z9clamp_pwmd`, 즉 `clamp_pwm(double)`. 사람 눈에는 같은 이름이지만 심볼 수준에서는 남남이라 `U`가 해소되지 않는다. 실측 결과는 `undefined reference to 'clamp_pwm(int)'`다. 맹글링이 인자 타입까지 심볼에 새긴다는 것의 실전적 의미다 — 선언과 정의의 타입이 어긋나면 링크가 깨진다.
3. (a) 전처리 — `fatal error` + 헤더 파일을 못 찾았다. include 경로 문제다. (b) 링크 — 주체가 `ld`이고 `undefined reference`다. rclcpp 라이브러리가 링크 목록에 없다. (c) 컴파일 — `파일:줄:칸: error:` 형식에 "선언이 스코프에 없다"는 내용. 헤더 include 누락이나 오타다.
4. 원본 매크로의 치환 결과는 `1 + 2 * 1 + 2`(값 5), 괄호 버전은 `((1 + 2) * (1 + 2))`(값 9)다. 전처리기는 두 경우 모두 아무 불평이 없다 — 옳고 그름의 판단 자체가 전처리기의 능력 밖이라는 것이 이 실습의 요점이다.
5. g++ 13.3 실측 기준 ②에서 `add.o`는 `T _Z3addii`, `main.o`는 `U _Z3addii`를 보여 주고, ④에서 `T add(int, int)`가 나온다(주소는 기기마다 다르다). ③의 순서를 바꿔 `g++ main.o -o calc`처럼 `add.o`를 빼고 링크해 보면 이 절 도입부의 `undefined reference`가 정확히 재현된다.
:::

읽기만 한 파이프라인은 남지 않는다. 지금 IDE 터미널에서 `g++ -std=c++20 --save-temps hello.cpp -o hello`를 치고 `hello.ii`, `hello.s`, `hello.o`를 각각 열어 눈으로 확인하라. 그다음 연습문제 5번의 파이프라인을 손으로 끝까지 돌려라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra -c main.cpp add.cpp && g++ main.o add.o -o calc && ./calc`다.

**다음 절**: [1.2 타입 시스템: 정수, 부동소수점, 문자](#/types) — `int`가 넘치면 무슨 일이 일어나는지, `0.1 + 0.2 != 0.3`이 왜 버그가 아닌지를 비트 수준에서 연다.

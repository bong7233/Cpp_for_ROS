# 2.2 포인터: 주소를 값으로 다룬다

::: lead
[1.6 함수: 오버로딩과 인자 전달](#/functions)에서 값 전달의 비용을 실측했다 — 8KB 구조체를 값으로 넘기면 호출마다 통째로 복사된다. 그런데 지금 절이 다루는 문제는 비용이 아니라 **애초에 안 되는 것**이다. 함수가 호출자의 변수 자체를 바꿔야 할 때, 값으로 받은 인자는 복사본이라 함수 안에서 아무리 휘저어도 원본은 멀쩡하다. 이 벽을 swap 함수로 직접 실측한 뒤, "변수의 주소를 값으로 넘긴다"는 한 문장으로 그 벽을 깨는 도구, 포인터로 들어간다. `&`와 `*`를 정확히 읽는 법, 포인터 선언을 해독하는 법, `nullptr`과 댕글링이라는 두 갈래의 실패, 그리고 이중 포인터까지 — 로봇 드라이버 SDK 함수 시그니처의 절반이 이 절의 재료로 만들어져 있다.
:::

## swap이 실패하는 이유

두 변수를 맞바꾸는 함수를 값 전달로 짜 보면 이렇다.

```cpp title="swap_val.cpp — 값으로 받아서 바꾼다"
#include <iostream>

void swap_broken(int a, int b) {
    int tmp = a;
    a = b;
    b = tmp;
}

int main() {
    int x = 42, y = 7;
    std::cout << "swap 전: x=" << x << " y=" << y << "\n";
    swap_broken(x, y);
    std::cout << "swap 후: x=" << x << " y=" << y << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra swap_val.cpp -o swap_val
$ ./swap_val
swap 전: x=42 y=7
swap 후: x=42 y=7
```

경고 하나 없이 컴파일됐고, 실행 결과는 바뀐 게 없다. `swap_broken` 안의 `a`와 `b`는 `x`, `y`의 **복사본**이다 — 호출되는 순간 함수의 스택 프레임에 새 정수 두 칸이 생기고, 거기에 42와 7이 복사된다. 함수는 그 복사본을 성실하게 맞바꿨다. 문제는 `main`의 `x`, `y`가 그 복사본과 애초에 다른 메모리라는 것이다. 함수가 끝나고 스택 프레임이 사라지면 맞바뀐 결과도 같이 사라진다.

고칠 방법은 하나뿐이다. 함수에게 **값 자체가 아니라 값이 있는 곳의 주소**를 알려주는 것.

```cpp title="swap_ptr.cpp — 주소로 받아서 바꾼다"
#include <iostream>

void swap_fixed(int* a, int* b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int main() {
    int x = 42, y = 7;
    std::cout << "swap 전: x=" << x << " y=" << y << "\n";
    swap_fixed(&x, &y);
    std::cout << "swap 후: x=" << x << " y=" << y << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra swap_ptr.cpp -o swap_ptr
$ ./swap_ptr
swap 전: x=42 y=7
swap 후: x=7 y=42
```

이번엔 바뀐다. `swap_fixed`는 여전히 값을 받는다 — 다만 그 값이 `int`가 아니라 `int*`, 즉 "x가 어디 있는지"다. `&x`가 그 주소를 만들고, 함수 안의 `*a`가 그 주소로 가서 진짜 `x`를 건드린다. **포인터도 값이다.** 복사되는 것은 정수 대신 주소일 뿐, 함수가 인자를 복사본으로 받는다는 규칙 자체는 그대로다. 다만 그 복사본이 담긴 것이 "원본이 어디 있는지 아는 지도"라서, 지도를 따라가면 원본에 닿는다. 이 절 전체가 이 한 문장의 전개다.

## 포인터는 그냥 값이다

지도의 정체부터 실측한다. 포인터는 특별한 존재가 아니라 **주소 하나를 담는 정수 같은 것**이다.

```cpp title="sizeof_ptr.cpp — 포인터의 크기는 대상과 무관하다"
#include <iostream>

int main() {
    int x = 42;
    int* p = &x;
    double* dp = nullptr;
    char* cp = nullptr;

    std::cout << "sizeof(int)     = " << sizeof(int) << "\n";
    std::cout << "sizeof(int*)    = " << sizeof(int*) << "\n";
    std::cout << "sizeof(double*) = " << sizeof(dp) << "\n";
    std::cout << "sizeof(char*)   = " << sizeof(cp) << "\n";
    std::cout << "x               = " << x << "\n";
    std::cout << "&x              = " << &x << "\n";
    std::cout << "p               = " << p << "\n";
    std::cout << "*p              = " << *p << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra sizeof_ptr.cpp -o sizeof_ptr
$ ./sizeof_ptr
sizeof(int)     = 4
sizeof(int*)    = 8
sizeof(double*) = 8
sizeof(char*)   = 8
x               = 42
&x              = 0x7ffc6a53c78c
p               = 0x7ffc6a53c78c
*p              = 42
```

(주소는 ASLR 때문에 실행마다 바뀐다 — 지금은 자릿수와 관계만 보라.) `int*`도 `double*`도 `char*`도 전부 8바이트, x86-64의 주소 폭 그대로다. `int`를 가리키든 8KB짜리 구조체를 가리키든 포인터 자신의 크기는 안 변한다 — [1.2](#/types)에서 `sizeof(void*)`로 이미 확인한 LP64 배치와 같은 사실이다. 그리고 `p`를 그냥 출력하면 `&x`와 정확히 같은 값이 나온다 — **포인터의 값은 주소이고, `&x`는 그 주소를 만드는 연산이다.**

두 연산자의 관계를 정확히 말하면 이렇다. `&`는 "이 변수가 어디 있는지" 묻는 연산자다 — 대상을 받아 주소를 낸다. `*`는 그 반대다 — 주소를 받아 "거기 있는 값"으로 되짚어 간다(**역참조**, dereference). `*p`가 42를 낸 것이 그 증거다. 이 둘은 서로의 역연산이라 `*&x`는 `x`와 같고, `&*p`는 `p`와 같다.

::: widget pointer-diagram
{ "scenario": "basics" }
:::

위젯에서 `p = &x`, `p = &y`, `*p = 99`, `p = nullptr` 버튼을 순서대로 눌러 보라. 포인터 박스 안에 적힌 값이 항상 **주소**라는 것, 화살표는 그 주소를 그림으로 옮긴 것일 뿐이라는 것, 그리고 `*p = 99`가 `p` 자신이 아니라 `p`가 **지금** 가리키는 셀을 고친다는 것을 눈으로 따라가라. 마지막 버튼에서 `p`가 `nullptr`이 된 뒤에는 화살표가 아예 사라진다 — 다음 소절이 그 상태를 파고든다.

### 선언은 오른쪽에서 왼쪽으로 읽는다

`int* p;`라는 선언을 말로 옮기면 "p는 int를 가리키는 포인터다"다. 이름(`p`)에서 시작해 바깥쪽으로 한 겹씩 벗겨 읽으면 된다 — "p는", "포인터다(`*`)", "무엇을 가리키는 포인터냐면 int". `*`는 타입의 일부이지 변수의 일부가 아니다. 이 사실이 실전에서 문제가 되는 지점이 하나 있다.

```cpp title="decl_trap.cpp — int* a, b; 는 두 개의 포인터가 아니다"
#include <iostream>
#include <type_traits>

int main() {
    int* a, b;   // a는 int*, b는 그냥 int
    a = nullptr;
    b = 3;
    std::cout << std::boolalpha;
    std::cout << "is_same<decltype(a), int*> = "
              << std::is_same_v<decltype(a), int*> << "\n";
    std::cout << "is_same<decltype(b), int>   = "
              << std::is_same_v<decltype(b), int> << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra decl_trap.cpp -o decl_trap    (경고 없음)
$ ./decl_trap
is_same<decltype(a), int*> = true
is_same<decltype(b), int>   = true
```

::: danger int* a, b; 는 조용히 다른 타입 두 개를 만든다
`*`가 타입이 아니라 **각 선언자에** 붙는다는 것이 진짜 규칙이다. `int* a, b;`는 "`int*` 타입 둘"이 아니라 "`a`는 `int*`, `b`는 `int`"다 — 포인터를 둘 다 만들고 싶었다면 `int *a, *b;`라고 별표를 각각에 붙여야 한다. `-Wall -Wextra`도 이 줄에 아무 경고를 주지 않는다. 함수 시그니처의 파라미터 목록에서 `int* joint_angles, obstacle_count`처럼 한 줄에 여러 개를 선언하면, 포인터일 거라 믿었던 변수 하나가 조용히 평범한 정수가 되는 버그가 생긴다. 처방은 규칙 하나다. **포인터는 한 줄에 하나씩 선언하거나, 별표를 변수마다 붙여라.**
:::

## nullptr: "아무것도 가리키지 않음"을 값으로

포인터가 아직 가리킬 대상이 없거나, 더 이상 가리킬 게 없어졌을 때가 있다. C는 이 상태를 정수 0(또는 매크로 `NULL`)으로 흉내 냈고, C++11은 전용 키워드 `nullptr`을 도입했다. 둘의 차이가 실전에서 실제로 컴파일을 깨는 것부터 본다.

```cpp title="null_overload.cpp — NULL은 정수인가 포인터인가"
#include <cstddef>
#include <iostream>

void handle(int code) {
    std::cout << "handle(int) 호출, code=" << code << "\n";
}

void handle(int* ptr) {
    std::cout << "handle(int*) 호출, ptr=" << ptr << "\n";
}

int main() {
    handle(NULL);       // 어느 쪽이 불릴까?
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra null_overload.cpp -o null_overload
null_overload.cpp: In function 'int main()':
null_overload.cpp:13:11: error: call of overloaded 'handle(NULL)' is ambiguous
   13 |     handle(NULL);
      |     ~~~~~~^~~~~~
null_overload.cpp:4:6: note: candidate: 'void handle(int)'
null_overload.cpp:8:6: note: candidate: 'void handle(int*)'
```

컴파일이 아예 막힌다. g++ 13.3의 `NULL`은 매크로 `__null`로 확장되는데, 이 값이 `int`로도 `int*`로도 똑같이 자연스럽게 변환될 수 있어서 오버로드 해석이 승자를 못 고른다. 다른 컴파일러·다른 표준 라이브러리에서는 `NULL`이 그냥 `0`이라 `handle(int)` 쪽이 조용히 (경고 없이) 뽑히기도 한다 — 어느 쪽이든 반갑지 않다. 하나는 컴파일이 안 되고, 하나는 "포인터를 넘긴다"고 쓴 코드가 정수 오버로드로 새 나간다. `nullptr`과 `0`을 넣으면 문제가 사라진다.

```cpp title="null_overload2.cpp — 조각: handle 두 오버로드는 위 예제와 같다"
#include <iostream>
// handle(int)/handle(int*) 두 오버로드는 앞의 null_overload.cpp와 동일하다.

int main() {
    handle(nullptr);    // int*로만 변환 가능 — 모호하지 않다
    handle(0);          // 정수 리터럴 — int로 정확히 일치, 모호하지 않다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra null_overload2.cpp -o null_overload2
$ ./null_overload2
handle(int*) 호출, ptr=0
handle(int) 호출, code=0
```

`nullptr`은 전용 타입 `std::nullptr_t`를 가진 리터럴이라 포인터 쪽으로만 변환된다. 정수 오버로드와 절대 헷갈리지 않는다. **포인터에 "아직 없음"을 표시할 때는 무조건 `nullptr`을 써라** — C 코드나 옛 API를 상대할 때만 `NULL`을 읽는 쪽으로 마주친다.

`nullptr`을 역참조하면 어떻게 되는지도 실측해 둘 가치가 있다.

```cpp title="null_deref.cpp"
#include <iostream>

int main() {
    int* p = nullptr;
    std::cout << *p << "\n";   // nullptr 역참조
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=undefined null_deref.cpp -o null_deref
$ ./null_deref
null_deref.cpp:5:24: runtime error: load of null pointer of type 'int'
[이후 세그폴트로 종료]
```

UBSan(`-fsanitize=undefined`)은 역참조 순간 정확한 진단(`load of null pointer of type 'int'`)을 찍고, 그 직후 세그폴트로 죽는다. 새니타이저 없이 그냥 실행해도 결과는 같다 — `0` 번지는 이 프로세스에 매핑돼 있지 않은 주소라 대개 즉시 크래시로 끝난다. 이 즉사가 오히려 다행이다. 다음 소절의 댕글링은 크래시조차 안 나는 경우가 있어서 더 위험하다.

::: tip 널 체크 관용구
포인터가 인자로 들어오거나 어떤 조작(예: 검색 실패)의 결과일 때는 역참조 전에 반드시 확인한다. `if (p) { ... }`와 `if (p != nullptr) { ... }`는 완전히 같은 뜻이다 — 포인터가 조건식 자리에서 `nullptr`이 아니면 참으로 암묵 변환되기 때문이다. 팀 관례에 따라 어느 쪽을 써도 되지만, 한 코드베이스 안에서는 하나로 통일해라.
:::

## 댕글링 포인터: 죽은 곳을 가리키는 주소

`nullptr`은 "처음부터 아무것도 없음"이 눈에 보이는 상태다. 더 무서운 쪽은 **한때는 유효했다가 조용히 죽어버린** 주소다 — 댕글링 포인터(dangling pointer). 블록 스코프 하나로 재현한다.

```cpp title="uas.cpp — 블록이 끝나면 그 안의 변수도 끝난다"
#include <iostream>

int main() {
    int* p;
    {
        int local = 42;   // 이 블록 스코프 안에서만 산다
        p = &local;
    }                     // local은 여기서 소멸한다 — p는 이제 댕글링 포인터다
    std::cout << *p << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g uas.cpp -o uas
uas.cpp: In function 'int main()':
uas.cpp:9:24: warning: using dangling pointer 'p' to 'local' [-Wdangling-pointer=]
$ ./uas
42
```

g++ 13.3은 `-Wall`만으로도 이 실수를 잡아 `-Wdangling-pointer=` 경고를 준다 — **경고를 무시하고 실행하면 42가 나온다.** `local`이 있던 스택 자리가 아직 재사용되지 않아 옛 값이 우연히 남아 있었을 뿐이다. 크래시도 없이 "정상"으로 보이는 이 결과가 댕글링 포인터의 진짜 위험이다 — 코드 리뷰도, 몇 번의 테스트 실행도 통과할 수 있다. AddressSanitizer는 스택 프레임에 "이 구간은 스코프 밖"이라는 표시를 심어 두고 이 접근을 잡아낸다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address uas.cpp -o uas_asan
$ ./uas_asan
==15341==ERROR: AddressSanitizer: stack-use-after-scope on address 0x7fa568500020 ...
READ of size 4 at 0x7fa568500020 thread T0
    #0 0x... in main uas.cpp:9
Address 0x7fa568500020 is located in stack of thread T0 at offset 32 in frame
    #0 0x... in main uas.cpp:3
  This frame has 1 object(s):
    [32, 36) 'local' (line 6) <== Memory access at offset 32 is inside this variable
SUMMARY: AddressSanitizer: stack-use-after-scope uas.cpp:9 in main
```

진단명이 `stack-use-after-scope`다 — 스코프가 끝난 변수를 스코프 밖에서 읽었다는 뜻이다. `local`이 죽은 뒤 그 자리를 밟은 정확한 줄(9번)과 원래 선언(6번)까지 짚는다. 힙에서 같은 일이 나면 진단명은 `heap-use-after-free`로 바뀐다 — `delete`한 포인터를 계속 쓰는 경우다. 두 진단 모두 [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)에서 원리부터 다시 다룬다. 지금 가져갈 결론은 하나다. **포인터가 가리키는 대상이 "아직 살아 있는가"를 항상 의식하고 있어야 하고, 그 확신이 안 서면 ASan 빌드로 돌려서 확인한다.**

댕글링을 원천적으로 막는 정공법은 "포인터를 손으로 만들지 않는" 쪽이다 — 소유권을 가진 스마트 포인터(`std::unique_ptr`, `std::shared_ptr`)가 객체 수명을 대신 관리해서, 이 실수 자체가 타입 시스템에서 막힌다. 그 이야기는 [2.9 unique_ptr](#/unique-ptr)와 [2.10 shared_ptr](#/shared-ptr)의 몫이다. 지금은 현상과 그 공포를 정확히 아는 것으로 충분하다.

## 이중 포인터와 포인터 배열

포인터가 가리키는 대상이 또 포인터일 수 있다 — **이중 포인터**(`T**`)다. 처음 보면 헷갈리지만, 규칙은 한 겹씩 벗기면 그대로다.

```cpp title="double_ptr.cpp — 한 겹씩 벗겨서 읽는다"
#include <iostream>

int main() {
    int x = 42, y = 7;
    int* p = &x;
    int** pp = &p;

    std::cout << "p   = " << p  << "  (x의 주소)\n";
    std::cout << "pp  = " << pp << "  (p의 주소)\n";
    std::cout << "*pp = " << *pp << "  (p의 값, 즉 x의 주소와 같다)\n";
    std::cout << "**pp = " << **pp << "\n";

    **pp = 99;
    std::cout << "**pp = 99 실행 후 x = " << x << "\n";

    *pp = &y;   // p 자체를 바꾼다 — pp를 통해서
    std::cout << "*pp = &y 실행 후 p == &y ? "
              << std::boolalpha << (p == &y) << "\n";
    std::cout << "**pp = " << **pp << "  (이제 y)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra double_ptr.cpp -o double_ptr
$ ./double_ptr
p   = 0x7fff61230470  (x의 주소)
pp  = 0x7fff61230478  (p의 주소)
*pp = 0x7fff61230470  (p의 값, 즉 x의 주소와 같다)
**pp = 42
**pp = 99 실행 후 x = 99
*pp = &y 실행 후 p == &y ? true
**pp = 7  (이제 y)
```

`pp`는 `p`가 어디 있는지를 담는다 — `p`도 결국 메모리 위의 변수이니 자기 주소가 있다. `*pp`로 한 번 벗기면 `p`(즉 `x`의 주소)가 나오고, 거기서 한 번 더 벗기면(`**pp`) 진짜 `x`가 나온다. 핵심은 마지막 줄이다. `*pp = &y`는 `pp`가 가리키는 대상, 즉 **`p` 자신**을 고쳐 쓴다 — `pp`를 통해서 `p`가 `y`를 가리키도록 바꿔치기한 것이다. `pp`는 여전히 `p`를 가리키지만, `p`가 이제 다른 곳을 가리킨다.

::: widget pointer-diagram
{ "scenario": "double-pointer" }
:::

`*pp = &y` 버튼을 눌러 보라. `pp`에서 나가는 화살표는 그대로 `p`를 향하고, **`p`에서 나가는 화살표가 `x`에서 `y`로 옮겨 붙는다.** 이것이 이중 포인터의 존재 이유다 — "포인터 변수 자체를 함수 밖에서 바꿔치기하고 싶다"는 요구가 이 그림 하나로 요약된다.

### 왜 실전에서 이중 포인터를 만나는가

일상 C++ 코드에서 `T**`를 직접 쓸 일은 드물다. 그런데 두 자리에서는 피할 수 없다.

**C 스타일 API의 출력 인자.** 로봇 모터·센서 드라이버 SDK는 대개 이런 모양으로 "핸들을 만들어서 돌려준다."

```cpp title="driver_api.cpp — 드라이버 SDK가 이중 포인터를 쓰는 전형적인 이유"
#include <iostream>

struct MotorHandle { int id; double last_current; };

// 실패하면 음수를 반환하고, 성공하면 *out_handle에 새 핸들 주소를 채운다.
int motor_open(int id, MotorHandle** out_handle) {
    if (id < 0) return -1;
    MotorHandle* h = new MotorHandle{id, 0.0};
    *out_handle = h;      // 호출자의 포인터 변수 자체를 채운다
    return 0;
}

int main() {
    MotorHandle* handle = nullptr;
    int rc = motor_open(3, &handle);   // handle의 주소를 넘긴다

    if (rc == 0 && handle != nullptr) {
        std::cout << "모터 " << handle->id << " 오픈 성공, handle=" << handle << "\n";
    }
    delete handle;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra driver_api.cpp -o driver_api
$ ./driver_api
모터 3 오픈 성공, handle=0x5584b44a12b0
```

`motor_open`은 반환값을 이미 성공/실패 코드로 쓰고 있다 — 그래서 만들어진 핸들은 **다른 통로**로 돌려줘야 한다. 그 통로가 "호출자가 들고 있는 `handle`이라는 포인터 변수 자체를 함수가 대신 채워 넣는" 이중 포인터 파라미터다. 이 패턴은 swap 예제와 원리가 완전히 같다 — 함수가 호출자의 변수를 바꾸려면 그 변수의 주소를 받아야 한다는 규칙이, 변수가 포인터일 때는 자연히 이중 포인터가 된다.

**포인터의 배열.** `int main(int argc, char* argv[])`의 `argv`가 대표적이다. `argv`는 `char*`(문자열의 시작 주소) 원소들이 모인 배열이고, [1.7 배열과 문자열](#/arrays-strings)에서 다룬 붕괴 규칙 그대로 함수 파라미터 자리에서 `char**`로도 받을 수 있다. `argv[i]`가 `i`번째 명령줄 인자 문자열의 시작 주소, `*argv`가 `argv[0]`과 같다 — 겉모습은 이중 포인터지만 정체는 "포인터들의 배열이 첫 원소의 포인터로 붕괴한 것"이다.

## const와 포인터

포인터가 얽히면 `const`를 어디에 붙이느냐에 따라 뜻이 완전히 갈린다. 세 조합을 표로 정리하고, 실제로 어긴 코드가 어떻게 막히는지 컴파일로 확인한다.

| 선언 | 읽는 법 | 못 하는 것 |
| --- | --- | --- |
| `const int* p` | p는 "const int를 가리키는" 포인터 | `*p`로 값 수정 불가 |
| `int* const p` | p **자신**이 const인 "int를 가리키는" 포인터 | `p`의 재대입 불가 |
| `const int* const p` | 값도, p 자신도 둘 다 const | 둘 다 불가 |

읽는 요령은 여기서도 오른쪽에서 왼쪽이다. `const`가 `*` **앞**에 있으면 "가리키는 값이 const", `*` **뒤**에 있으면 "포인터 자신이 const"다.

```cpp title="const_ptr.cpp — 조각: 세 조합, ❌ 줄의 주석을 하나씩 풀어서 확인한다"
int x = 42, y = 7;

const int* p1 = &x;        // 가리키는 int가 const
// *p1 = 1;                 // ❌ 주석을 풀면 컴파일 에러
p1 = &y;                     // ✅ p1 자체는 재대입 가능

int* const p2 = &x;         // p2 자체가 const
*p2 = 1;                     // ✅ 가리키는 값은 수정 가능
// p2 = &y;                  // ❌ 주석을 풀면 컴파일 에러

const int* const p3 = &x;   // 값도 p3 자신도 둘 다 const
// *p3 = 1;                  // ❌ 주석을 풀면 컴파일 에러 (read-only location)
// p3 = &y;                  // ❌ 주석을 풀면 컴파일 에러 (read-only variable)
```

이 조각을 `int main() { ... return 0; }`로 감싸 그대로 빌드하면 에러 없이 통과한다 — `❌` 줄이 전부 주석이라서다(`p1`, `p3`를 다른 데서 안 읽는다는 `unused` 경고는 뜬다. 아래 실험과 무관하니 무시해도 좋다). 이제 한 줄씩 주석을 풀어 다시 빌드하면 정확히 그 줄만 막힌다.

```console
$ g++ -std=c++20 -Wall -Wextra const_ptr.cpp -o const_ptr   (*p1 = 1; 의 주석만 풀었을 때)
const_ptr.cpp:5:9: error: assignment of read-only location '* p1'
    5 |     *p1 = 1;
      |     ~~~~^~~

$ g++ -std=c++20 -Wall -Wextra const_ptr.cpp -o const_ptr   (p2 = &y; 의 주석만 풀었을 때)
const_ptr.cpp:10:8: error: assignment of read-only variable 'p2'
   10 |     p2 = &y;
      |     ~~~^~~~

$ g++ -std=c++20 -Wall -Wextra const_ptr.cpp -o const_ptr   (*p3 = 1; 의 주석만 풀었을 때)
const_ptr.cpp:13:9: error: assignment of read-only location '*(const int*)p3'
   13 |     *p3 = 1;
      |     ~~~~^~~

$ g++ -std=c++20 -Wall -Wextra const_ptr.cpp -o const_ptr   (p3 = &y; 의 주석만 풀었을 때)
const_ptr.cpp:14:8: error: assignment of read-only variable 'p3'
   14 |     p3 = &y;
      |     ~~~^~~~
```

네 에러 메시지가 표를 그대로 확인해 준다. `p1`, `p3`처럼 **가리키는 값**이 const면 "읽기 전용 위치(read-only location)"에 대입했다는 에러가, `p2`, `p3`처럼 **포인터 자신**이 const면 "읽기 전용 변수(read-only variable)"에 대입했다는 에러가 난다. `p3`는 둘 다 const라서 두 종류 에러를 전부 낸다 — 표의 세 번째 행이 두 규칙을 동시에 잠근다는 것이 메시지 문구 차이로 그대로 드러난다.

함수 시그니처에서는 이 조합이 계약이 된다. `void print(const int* p)`는 "p가 가리키는 값을 읽기만 하겠다"는 약속이고, 호출자는 그 약속을 믿고 원본을 넘긴다. 로봇 드라이버 API에서 관절 각도 배열을 "읽기만 하는" 함수라면 파라미터는 예외 없이 `const double*`(또는 `const double&`)여야 한다 — 그 함수 안에서 실수로 원본을 고치는 버그가 타입 시스템에서 막힌다.

## 포인터 대신 레퍼런스라는 선택지

포인터로 swap을 고쳤지만, 실무 C++ 코드에서 "인자를 수정하고 싶다"는 목적 하나만 있다면 포인터보다 **레퍼런스**를 더 자주 쓴다 — `nullptr`이 될 수 없고, 한 번 바인딩되면 다른 대상으로 옮겨갈 수 없다는 제약이 오히려 안전성이 된다. 포인터와 레퍼런스가 컴파일러 수준에서 얼마나 다른 존재인지, 왜 레퍼런스에는 재바인딩이 없는지는 [2.3 레퍼런스: 별명의 규칙](#/references)에서 정면으로 다룬다.

::: interview 댕글링 포인터가 뭐고 어떻게 막나
메모리 관련 질문 중 가장 자주 나온다. 답변 뼈대: ① 댕글링 포인터는 가리키던 객체가 이미 소멸했거나(스코프 종료, 함수 반환) 해제됐는데(`delete`, `free`) 여전히 그 주소를 들고 있는 포인터다. ② 위험한 이유는 크래시가 보장되지 않는다는 것 — 실측에서 스코프가 끝난 지역 변수를 읽었더니 크래시 없이 옛 값이 그대로 나왔다. ③ 잡는 도구는 AddressSanitizer — 스코프 이탈은 `stack-use-after-scope`, 해제된 메모리는 `heap-use-after-free`로 각각 잡는다. ④ 근본 처방은 원시 포인터로 수명을 손으로 관리하지 않는 것 — `std::unique_ptr`/`std::shared_ptr`가 객체 수명과 포인터 유효성을 자동으로 맞춰 준다는 것까지 말하면 상급이다.
:::

## 요약

- 값 전달로는 호출자의 변수를 못 바꾼다 — swap 실측: 값 전달은 원본 불변, 주소 전달(`int*`)은 실제로 맞바뀐다.
- 포인터는 주소를 담는 값이다 — `int*`/`double*`/`char*` 전부 8바이트(x86-64) 실측, 가리키는 대상의 크기와 무관하다. `&`는 주소를 만들고 `*`는 역참조한다.
- 선언은 이름에서 바깥으로 읽는다 — `int* p`는 "p는 int를 가리키는 포인터"다. `int* a, b;`는 `a`만 포인터이고 `b`는 그냥 `int` — 경고 없이 조용히 틀린다.
- `nullptr`을 써라. `NULL`은 `handle(int)`/`handle(int*)` 오버로드에서 **모호성 에러**를 냈다(g++ 13.3 실측) — 다른 환경에서는 조용히 정수 쪽으로 새기도 한다. `nullptr` 역참조는 UBSan이 `load of null pointer`로 정확히 잡는다.
- 댕글링 포인터는 죽은 대상을 가리키는 포인터다 — 스코프가 끝난 지역 변수를 가리킨 포인터를 읽었더니 크래시 없이 옛 값이 나왔다(g++ 13.3 실측). ASan은 이를 `stack-use-after-scope`로 잡는다 — [2.11](#/ub-sanitizers)에서 계속.
- 이중 포인터(`T**`)는 "포인터 변수 자신을 함수 밖에서 바꿔치기"하는 도구다 — C 드라이버 SDK의 출력 인자(`motor_open(id, &handle)`)와 `argv`가 실전에서 만나는 자리다.
- `const int*`는 값을 못 바꾸고, `int* const`는 포인터 자신을 못 바꾼다 — 컴파일 에러로 실측 확인. 함수 시그니처의 `const T*`는 "읽기만 한다"는 계약이다.

::: quiz 연습문제
1~3번은 예측·개념 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. 다음 선언에서 `b`의 타입은 무엇인가. `q`를 역참조(`*q`)하는 코드를 추가하면 어떤 에러가 나는가.

   ```cpp
   int* p, q;
   ```

2. `handle(NULL)`이 이 절의 실측에서 컴파일 에러(모호성)를 냈다. `handle(0)`은 왜 모호하지 않은가? `0`과 `NULL`의 차이를 한 문장으로 설명하라.

3. 이중 포인터 예제의 마지막 두 줄, `*pp = &y;`와 `p == &y`의 관계를 설명하라. `pp` 자신이 가리키는 대상은 이 연산 전후로 바뀌었는가?

4. (실습) 힙 use-after-free를 ASan으로 잡기: `int* p = new int(42);` 다음 `delete p;`를 하고, 그 뒤에 `*p`를 읽는 프로그램을 작성하라. 먼저 ASan 없이 빌드해 실행해 보고, 그다음 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address`로 다시 빌드해 실행하라. 성공 기준: 리포트에서 ① 진단명이 `heap-use-after-free`인 것 ② `freed by thread T0 here`와 `previously allocated by thread T0 here` 두 스택 트레이스를 찾아 각각 어느 줄인지 말할 수 있다.
5. (실습) const 포인터 조합 컴파일 실험: 본문의 `const_ptr.cpp`를 `int main() { ... }`로 감싸 직접 치고, 주석 처리된 네 줄(`*p1 = 1;`, `p2 = &y;`, `*p3 = 1;`, `p3 = &y;`)을 하나씩 살려 가며 각각 어떤 컴파일 에러 문구가 나오는지 기록하라. 성공 기준: `const int* const p3`에서 두 종류의 위반이 각각 다른 에러 문구("read-only location" vs "read-only variable")로 구분되는 것을 직접 확인했다.
:::

::: answer 해설
1. `p`만 `int*`이고 `q`는 `int`다. `*q`를 추가하면 `int`에 단항 `*`를 적용하는 것이라 "invalid type argument of unary '*' (have 'int')" 류의 컴파일 에러가 난다 — 애초에 포인터가 아니므로 역참조할 수 없다는 뜻이다.
2. `0`은 정수 리터럴이라 `int` 오버로드와 **정확히 일치**해서 모호성이 없다(포인터로 가려면 표준 변환을 한 단계 거쳐야 하므로 서열이 밀린다). `NULL`은(이 환경에서 g++가 매크로로 심는 `__null`) `int`로도 `int*`로도 동등하게 자연스러운 변환이 가능해 오버로드 해석이 우열을 못 가린다. 근본 원인은 `NULL`이 표준상 "정수 0 또는 포인터 상수"라는 애매한 존재로만 정의돼 있다는 것이다.
3. `*pp = &y;`는 `pp`가 가리키는 대상, 즉 `p`를 고쳐 쓴 것이다. 실행 후 `p == &y`는 `true`다 — `p`가 이제 `y`를 가리킨다는 뜻이다. `pp` 자신이 가리키는 대상은 바뀌지 않았다 — `pp`는 이 연산 전에도 후에도 여전히 `p`(그 변수 자체)를 가리킨다. 바뀐 것은 `p`의 **내용물**이지 `pp`의 화살표가 아니다.
4. ASan 없는 실행은 크래시 없이 통과하는 경우가 흔하다 — 해제 직후 그 메모리가 재사용되기 전이면 여전히 42가 남아 있을 수 있다(보장은 없다). ASan 빌드는 `heap-use-after-free`를 잡아, `delete p`가 일어난 줄(freed by)과 `new int(42)`가 일어난 줄(previously allocated by), 그리고 실제로 읽은 줄(READ of size 4) 셋을 모두 스택 트레이스로 짚는다.
5. 실측: `*p1 = 1;`은 `error: assignment of read-only location '* p1'`, `p2 = &y;`는 `error: assignment of read-only variable 'p2'`다. `const int* const p3`에서 `*p3 = 1;`을 살리면 첫 번째와 같은 "read-only location" 계열 에러가, `p3 = &y;`를 살리면 두 번째와 같은 "read-only variable" 계열 에러가 난다 — 표의 세 번째 행이 둘 다 잠근다는 것을 두 에러 문구로 각각 확인하는 것이 이 실습의 목적이다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `swap_val.cpp` → `swap_ptr.cpp` 순서로 쳐서 "안 바뀌는 것"과 "바뀌는 것"을 같은 손으로 확인하고, `uas.cpp`는 일반 빌드와 ASan 빌드를 둘 다 돌려 결과 차이("정상으로 보임" vs "즉시 잡힘")를 눈으로 봐라. 기준 명령은 `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, 새니타이저는 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`(UBSan은 `address`를 `undefined`로 바꾼다).

**다음 절**: [2.3 레퍼런스: 별명의 규칙](#/references) — 포인터와 같은 능력을 가지면서도 `nullptr`이 될 수 없고 재바인딩도 없는 또 다른 간접 참조, 레퍼런스로 넘어간다. 포인터를 어디까지 쓰고 어디서부터 레퍼런스로 바꿔야 하는지가 그 절의 질문이다.

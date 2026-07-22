# 2.3 레퍼런스: 별명의 규칙

::: lead
[1.6](#/functions)에서 이미 `const&`로 인자를 받았다 — 큰 구조체를 복사 없이 넘기려고 썼다. 그런데 그 `&`가 정확히 뭘 하는 건지는 미뤄 뒀다. 이 절은 그 빚을 갚는다. 레퍼런스는 포인터의 다른 문법이 아니다 — 같은 객체를 가리키는 **두 번째 이름**이고, 이 한 문장의 함의를 끝까지 따라가면 재바인딩이 없는 이유, 널 레퍼런스가 없는 이유, `const&`가 함수 인자의 기본값이 된 이유가 전부 나온다. [2.2 포인터](#/pointers)가 화살표로 이해할 대상이라면, 이 절은 정반대다 — **화살표를 그리는 순간 잘못된 그림이 된다.** 그래서 이 절에는 위젯이 없다. 레퍼런스는 원본과 분리된 별개의 상자가 아니라 같은 상자에 붙은 두 번째 명찰이고, 화살표는 "가리키는 대상이 따로 있다"는 그림을 강요하기 때문이다.
:::

## 스왑 함수 두 벌 — 호출부가 달라진다

두 정수를 맞바꾸는 함수를 [2.2](#/pointers)의 포인터로 짠 버전과, 레퍼런스로 짠 버전을 나란히 놓는다. 함수 본문보다 **호출부**를 눈여겨봐라.

```cpp title="swap_ptr_ref.cpp"
#include <iostream>

void swap_ptr(int* a, int* b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

void swap_ref(int& a, int& b) {
    int tmp = a;
    a = b;
    b = tmp;
}

int main() {
    int x = 10, y = 20;
    swap_ptr(&x, &y);
    std::cout << "포인터 버전 호출 후: x=" << x << " y=" << y << "\n";

    swap_ref(x, y);
    std::cout << "레퍼런스 버전 호출 후: x=" << x << " y=" << y << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra swap_ptr_ref.cpp -o swap_ptr_ref
$ ./swap_ptr_ref
포인터 버전 호출 후: x=20 y=10
레퍼런스 버전 호출 후: x=10 y=20
```

두 함수는 값을 맞바꾼다는 점에서 결과가 같다. 그런데 `swap_ptr`은 호출부에서 `&x, &y`로 **주소를 명시적으로 떠서** 넘겼고, 함수 본문은 `*a`, `*b`로 매번 역참조했다. `swap_ref`는 호출부가 `x, y`로 값을 넘기는 모양 그대로이고, 본문도 `a`, `b`를 보통 변수처럼 썼다. 그런데도 `a`를 바꾸면 `x`가 바뀐다. 함수 밖에서 보면 인자 전달 문법이 값 전달과 똑같은데, 함수 안에서는 원본이 바뀐다 — 이게 레퍼런스다. **역참조 없이 원본에 손을 대는 문법.**

::: note 이 절엔 위젯이 없다
스택/힙, 포인터는 "다른 곳에 있는 대상을 가리킨다"는 그림이 정확한 모델이라 위젯으로 그릴 가치가 있다. 레퍼런스는 다르다 — 가리키는 게 아니라 **같은 것**이다. 화살표를 그리면 상자가 두 개로 보이고, 그 순간 "레퍼런스는 원본과 별개의 존재"라는 잘못된 모델이 독자 머리에 박힌다. 그래서 이 절은 그림 대신 실측으로 간다 — 주소를 직접 찍어서 "정말 같은 것"임을 증명하는 쪽이 훨씬 정직하다.
:::

## 레퍼런스는 별명이다

"별명(alias)"이라는 말을 문학적 비유로 두지 않는다. 주소를 직접 찍어서 확인한다.

```cpp title="addr.cpp"
#include <iostream>

int main() {
    int x = 42;
    int& r = x;
    std::cout << "&x = " << &x << "\n";
    std::cout << "&r = " << &r << "\n";
    std::cout << std::boolalpha << "&r == &x ? " << (&r == &x) << "\n";
    std::cout << "sizeof(x) = " << sizeof(x) << "\n";
    std::cout << "sizeof(r) = " << sizeof(r) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra addr.cpp -o addr
$ ./addr
&x = 0x7ffc0ef24a5c
&r = 0x7ffc0ef24a5c
&r == &x ? true
sizeof(x) = 4
sizeof(r) = 4
```

`&r`이 `&x`와 완전히 같은 주소를 낸다. `sizeof(r)`도 `int`인 `x`의 크기 그대로 4다 — 레퍼런스 "자체"의 크기를 물을 방법이 언어에 없다. `&r`이라고 쓰면 항상 원본의 주소가 나오고, `sizeof(r)`이라고 쓰면 항상 원본의 크기가 나온다. 포인터라면 `&p`가 포인터 변수 자신의 주소를(스택 어딘가에 8바이트로 존재하니까), `sizeof(p)`가 포인터의 크기(8)를 냈을 것이다. 레퍼런스에는 그 "자기 자신"이라는 게 관찰되지 않는다. `r`은 이름 두 개 중 하나일 뿐, 별도의 저장 공간으로 스스로를 드러내지 않는다.

### 재바인딩이라는 흔한 오해

레퍼런스를 처음 보면 거의 모두가 같은 오해를 한다 — "`r = y`라고 쓰면 `r`이 이제 `y`를 가리키게 되는 거 아닌가?" 아니다. 초기화 시점에 한 번 바인딩된 뒤로는, `r`에 뭘 대입하든 그건 **`r`이 별명인 원본 객체에 대한 대입**이다. 실측으로 오해를 정면으로 깬다.

```cpp title="rebind.cpp"
#include <iostream>

int main() {
    int x = 1, y = 2;
    int& r = x;              // r은 x에 바인딩된다
    std::cout << "대입 전: x=" << x << " y=" << y << "\n";

    r = y;                   // 재바인딩이 아니라 대입이다

    std::cout << "대입 후: x=" << x << " y=" << y << "\n";
    std::cout << std::boolalpha << "&r == &x ? " << (&r == &x) << "\n";
    std::cout << "&r == &y ? " << (&r == &y) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra rebind.cpp -o rebind
$ ./rebind
대입 전: x=1 y=2
대입 후: x=2 y=2
&r == &x ? true
&r == &y ? false
```

`r = y;` 다음 줄에서 `x`가 `2`로 바뀌었다 — `y`의 **값**이 `x`에 복사됐다. 그런데 `&r == &x`는 여전히 `true`고, `&r == &y`는 여전히 `false`다. `r`은 대입 전이나 후나 한결같이 `x`의 별명이다. 딱 한 번, 선언 시점에만 바인딩이 일어난다. 그 뒤로 `r`이 나타나는 모든 자리는 곧 `x`가 나타나는 자리이지, "지금부터 어디를 가리킬지"를 다시 정하는 자리가 아니다.

::: danger `r = y`를 재바인딩으로 읽지 마라
포인터에 익숙한 채로 레퍼런스를 배우면 `r = y`를 `p = &y`(재대입)로 착각하기 쉽다. 실제로는 `*p = y`(역참조된 자리에 값 대입)에 해당한다. 이 착각인 채로 링크드 리스트나 트리 순회 코드를 레퍼런스로 짜면 "다음 노드로 넘어가는" 코드를 쓴 셈이 아니라 "현재 노드의 값을 덮어쓰는" 코드를 쓴 셈이 된다. 순회하듯 레퍼런스를 재대입하고 싶다면 애초에 포인터를 써야 한다 — 이게 아래 "포인터 vs 레퍼런스 선택 기준"의 첫 줄이다.
:::

### 널 레퍼런스가 없는 이유

포인터는 `nullptr`로 "아무것도 안 가리킨다"를 표현한다. 레퍼런스에는 그 상태가 없다 — 시도하면 컴파일러가 막는다.

```console
$ g++ -std=c++20 -Wall -Wextra -c null_ref.cpp
null_ref.cpp: In function 'int main()':
null_ref.cpp:2:14: error: invalid initialization of non-const reference of type 'int&' from an rvalue of type 'std::nullptr_t'
    2 |     int& r = nullptr;   // nullptr을 int&에 바인딩
      |              ^~~~~~~
```

레퍼런스는 "어떤 객체의 별명"으로 **정의**된다. 별명인데 원본이 없다는 것은 언어의 정의상 성립하지 않는 상태다 — 그래서 `nullptr`을 직접 바인딩하는 시도는 타입 불일치로 컴파일 단계에서 막힌다. 이 보장 덕분에 함수가 `const T&`를 인자로 받으면, 그 함수 안에서는 널 검사를 할 필요가 없다 — 정상적으로 초기화된 레퍼런스는 항상 유효한 객체를 가리킨다는 게 언어의 약속이다. (단, 이 약속을 억지로 깨는 경로 — 널 포인터를 역참조해 레퍼런스를 만드는 것 — 는 [2.11 댕글링, UB, 새니타이저](#/ub-sanitizers)의 몫이다. 문법이 막아 주는 것과 실제로 항상 안전한 것은 다른 이야기다.)

## 초기화 규칙: 반드시, 그리고 lvalue만

레퍼런스는 태어날 때 이미 무엇의 별명인지가 정해져야 한다. 그래서 초기화 없는 선언은 아예 문법 에러다.

```console
$ g++ -std=c++20 -Wall -Wextra -c must_init.cpp
must_init.cpp: In function 'int main()':
must_init.cpp:2:10: error: 'r' declared as reference but not initialized
    2 |     int& r;   // 초기화 없이 선언
      |          ^
```

포인터라면 `int* p;`는 (경고는 몰라도) 컴파일은 된다 — 그저 쓰레기 주소를 담은 채로 시작할 뿐이다. 레퍼런스는 언어 차원에서 그 여지 자체를 없앴다.

두 번째 규칙: 비`const` 레퍼런스는 **lvalue**(이름이 있고 주소를 뜰 수 있는 것)에만 바인딩된다. 임시값(rvalue)은 거부된다.

```console
$ g++ -std=c++20 -Wall -Wextra -c lvalue_only.cpp
lvalue_only.cpp: In function 'int main()':
lvalue_only.cpp:3:7: error: cannot bind non-const lvalue reference of type 'int&' to an rvalue of type 'int'
    3 |     f(5);   // rvalue를 비const 레퍼런스에
      |       ^
```

`5`는 이름이 없다. 함수가 그 값을 수정해 봐야 되돌려줄 변수가 없으니, "수정 가능한 별명"을 요구하는 비`const` 레퍼런스와는 애초에 안 맞는다. 이 규칙이 왜 있는지는 반대 사례를 보면 뒤집힌다.

### `const&`는 임시도 받는다 — 그리고 그 수명을 늘린다

`const T&`는 예외다. 값을 바꾸지 않겠다고 약속했으니, 임시값도 받아 준다.

```cpp title="const_ref_temp.cpp"
void g(const int& r) { /* r로 읽기만 한다 */ }
int main() {
    g(5);       // rvalue를 const&에는 바인딩 가능
    return 0;
}
```

이 코드는 경고 없이 컴파일된다. `5`처럼 사소한 값이 아니라 생성·소멸에 로그를 남기는 객체로 같은 상황을 만들면, 여기서 한 걸음 더 나간 규칙이 보인다 — **수명 연장(lifetime extension)**.

```cpp title="lifetime_ext.cpp"
#include <iostream>

struct Big {
    Big()  { std::cout << "  Big 생성\n"; }
    ~Big() { std::cout << "  Big 소멸\n"; }
};

Big make() { return Big(); }

int main() {
    std::cout << "-- 레퍼런스 바인딩 전 --\n";
    const Big& r = make();     // make()가 만든 임시 객체를 const&로 받는다
    std::cout << "-- r 바인딩 직후, 아직 살아있어야 한다 --\n";
    std::cout << "-- main 블록 끝 직전 --\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lifetime_ext.cpp -o lifetime_ext
$ ./lifetime_ext
-- 레퍼런스 바인딩 전 --
  Big 생성
-- r 바인딩 직후, 아직 살아있어야 한다 --
-- main 블록 끝 직전 --
  Big 소멸
```

`make()`가 반환한 임시 `Big`은 원래대로라면 그 문장이 끝나는 순간 소멸했어야 한다 — 다른 대부분의 임시값이 그렇게 사라진다. 그런데 `소멸` 로그는 `main` 블록이 끝나는 지점, 즉 `r`의 수명이 끝나는 지점에서야 찍혔다. 표준은 이렇게 정한다 — **const 레퍼런스가 임시값에 바인딩되면, 그 임시값의 수명이 레퍼런스의 수명으로 늘어난다.** 함수 인자로 받은 `const&`는 예외다(인자로 넘어온 임시값은 함수 호출이 끝나면 사라진다 — 늘어나는 건 지역 변수로 바인딩된 경우다). 이게 [1.6](#/functions)에서 "값을 넘겨도 되고 참조도 넘겨도 되는" `const&`가 함수 인자로 만능인 이유의 절반이다 — 나머지 절반은 복사 비용 회피이고, 이 절반은 임시값까지 아무 제약 없이 받아 준다는 유연성이다.

::: deep 레퍼런스는 보통 포인터로 컴파일된다
언어 의미론에서 레퍼런스는 "별명"이지 "가리키는 것"이 아니다. 그런데 함수 인자로 넘어가는 레퍼런스처럼 컴파일러가 별명 관계를 컴파일 타임에 완전히 알 수 없는 경우, 실제 기계어 수준에서는 대개 포인터와 똑같이 주소를 레지스터나 스택에 실어 넘긴다. `int& r = x;`처럼 지역 변수를 즉시 바인딩하는 경우는 최적화 단계에서 아예 `r`을 `x`로 치환해 버려 레퍼런스 자체가 기계어에 흔적을 안 남기기도 한다. 즉 "레퍼런스는 포인터다"는 구현 디테일로는 대체로 맞고, "레퍼런스는 포인터다"는 언어 의미론으로는 틀렸다 — 재바인딩 금지, 널 금지, `&`/`sizeof`가 원본을 가리키는 것 전부는 컴파일러가 유지하는 **약속**이지, 기계어가 자연히 주는 성질이 아니다.
:::

## 댕글링 레퍼런스 — 별명이 가리키던 원본이 사라진다

레퍼런스가 별명이라는 사실은 원본이 죽으면 별명도 의미를 잃는다는 뜻이다. 포인터의 댕글링과 성격이 같고, [0.3](#/first-build)에서 예고했던 그 문제다.

### 지역 변수를 참조로 반환하면

```cpp title="dangling_return.cpp"
#include <iostream>

int& make_dangling() {
    int local = 42;
    return local;      // 지역변수의 레퍼런스를 반환한다
}

int main() {
    int& r = make_dangling();
    std::cout << "r = " << r << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra dangling_return.cpp -o dangling_return
dangling_return.cpp: In function 'int& make_dangling()':
dangling_return.cpp:5:12: warning: reference to local variable 'local' returned [-Wreturn-local-addr]
    5 |     return local;      // 지역변수의 레퍼런스를 반환한다
      |            ^~~~~
$ ./dangling_return
Segmentation fault
```

경고가 정확히 문제를 짚어 준다 — g++는 이 패턴을 `-Wall`만으로 잡는다. 그런데 경고가 컴파일을 막지는 않으므로 실행파일은 만들어지고, 이 환경(g++ 13 / Linux x86-64 / `-O0`)에서 실행하면 **세그멘테이션 폴트로 죽는다.** `r`을 읽으려는 순간 `local`이 있던 스택 프레임은 이미 `make_dangling` 반환과 함께 무효화됐고, 우연히 그 자리가 더 이상 매핑되지 않은 주소였다. 다른 컴파일러, 다른 최적화 레벨에서는 크래시 대신 그냥 쓰레기 숫자가 찍힐 수도 있다 — **이 환경에서는 이렇게 나왔을 뿐, UB에는 보장이 없다.** ASan을 붙이면 같은 사고를 정확한 진단으로 바꿔 준다.

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address dangling_return.cpp -o dangling_return_asan
$ ./dangling_return_asan
AddressSanitizer:DEADLYSIGNAL
==15710==ERROR: AddressSanitizer: SEGV on unknown address 0x000000000000
    #0 ... in main
```

### 컨테이너 재할당으로 무효화되는 레퍼런스

지역 변수만 문제가 아니다. `std::vector`의 원소를 참조해 둔 상태에서 컨테이너가 커지면, 원본이 옮겨지면서 참조가 낡은 자리를 가리키게 된다.

```cpp title="vec_invalidate.cpp"
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v = {1, 2, 3};
    int& r = v[0];             // v[0]의 레퍼런스

    std::cout << "push_back 전: r=" << r << ", capacity=" << v.capacity() << "\n";

    for (int i = 0; i < 20; ++i) {
        v.push_back(i);
    }

    std::cout << "push_back 후: r=" << r << ", capacity=" << v.capacity() << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra vec_invalidate.cpp -o vec_invalidate
$ ./vec_invalidate
push_back 전: r=1, capacity=3
push_back 후: r=1677511638, capacity=24
```

`capacity`가 3에서 24로 뛴 것이 바로 재할당이 일어났다는 증거다 — 벡터는 기존 버퍼가 가득 차면 더 큰 새 버퍼를 힙에 새로 잡고 원소를 옮긴 뒤 옛 버퍼를 해제한다(성장 패턴의 전모는 [5.1 vector](#/vector)에서 다룬다). `r`은 옛 버퍼의 한 자리를 가리키던 별명이었는데, 그 버퍼가 해제되면서 `r`이 읽는 값은 이제 의미 없는 쓰레기다. ASan은 이 순간을 정확히 짚는다.

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address vec_invalidate.cpp -o vec_invalidate_asan
$ ./vec_invalidate_asan
==15710==ERROR: AddressSanitizer: heap-use-after-free on address 0x502000000010
READ of size 4 at 0x502000000010 thread T0
    #0 ... in main
freed by thread T0 here:
    #3 ... in _M_realloc_insert<int const&>
    #4 ... in vector<int>::push_back(int const&)
previously allocated by thread T0 here:
    #4 ... in vector<int>::vector(std::initializer_list<int>, ...)
SUMMARY: AddressSanitizer: heap-use-after-free
```

`heap-use-after-free` — ASan이 "이 메모리는 해제됐다"고 정확히 알려 준다. **어떤 자료구조든 원소를 재배치·삭제할 수 있는 연산 앞에서는, 그 전에 떠 둔 레퍼런스와 반복자를 전부 무효화된 것으로 취급해라.** 이 규칙의 전체 표는 [5.4 반복자와 무효화 규칙](#/iterators)에서 컨테이너별로 정리한다.

## 포인터 vs 레퍼런스 선택 기준

여기까지 모은 성질을 표로 정리하면 선택이 기계적으로 나온다.

| 필요한 것 | 선택 |
| --- | --- |
| 나중에 다른 대상으로 다시 가리켜야 한다(재바인딩) | 포인터 |
| "아무것도 없음"을 표현해야 한다(nullptr) | 포인터 |
| 함수가 그 대상의 소유권을 갖거나 넘겨야 한다 | 포인터 계열(대개 스마트 포인터, [2.9](#/unique-ptr)) |
| 그 외 — 이미 존재하는 객체를 그냥 다른 이름으로 다룬다 | 레퍼런스 |

원칙은 하나로 줄어든다. **소유하지 않고, 재바인딩할 일 없고, 반드시 대상이 있다는 게 보장되면 레퍼런스. 셋 중 하나라도 걸리면 포인터(혹은 스마트 포인터).** 함수 인자, 범위 기반 for의 루프 변수, 컨테이너 원소에 대한 짧은 접근 — 이 절 대부분의 예제가 전부 레퍼런스 편이었던 이유다.

### 멤버로서의 레퍼런스는 함정이다

지금까지 본 규칙을 클래스 멤버에 그대로 옮기면 뜻밖의 결과가 나온다.

```cpp title="member_ref.cpp"
struct Node {
    int& value;   // 멤버로서의 레퍼런스
};
```

```console
$ g++ -std=c++20 -Wall -Wextra -c member_ref.cpp
member_ref.cpp:11:10: error: use of deleted function 'Node& Node::operator=(const Node&)'
member_ref.cpp:3:8: note: 'Node& Node::operator=(const Node&)' is implicitly deleted because the default definition would be ill-formed:
member_ref.cpp:3:8: error: non-static reference member 'int& Node::value', cannot use default assignment operator
```

레퍼런스 멤버가 있으면 컴파일러가 자동으로 만들어 주던 복사 대입 연산자가 **통째로 삭제된다.** 이유는 이 절에서 이미 다룬 규칙 그대로다 — 대입은 재바인딩이 아니다. `n1 = n2`가 `value`까지 복사하려면 "`n1.value`가 가리키는 원본을 통째로 바꿔라"가 아니라 "`n1.value`가 가리키는 원본에 `n2.value`의 값을 대입해라"가 되어야 하는데, 그럼 `n1`과 `n2`가 서로 다른 객체를 참조하던 관계 자체는 그대로 남는다 — 컴파일러 입장에서는 이도 저도 아닌 모호한 동작이라 아예 만들기를 거부한다. 복사·대입이 필요한 클래스에 레퍼런스 멤버를 넣지 마라 — 포인터 멤버를 쓰거나, 값 자체를 저장해라. 복사 대입이 왜 이렇게 얽히는지는 [2.6 복사 시맨틱](#/copy-semantics)에서 정면으로 다룬다.

## auto와 레퍼런스: auto는 &를 벗긴다

`auto`로 변수를 선언하면 레퍼런스 자격은 저절로 벗겨지고 **값이 복사**된다. 실측으로 확인한다.

```cpp title="auto_strips_ref.cpp"
#include <iostream>

struct Counted {
    Counted()                   { std::cout << "  기본 생성자\n"; }
    Counted(const Counted&)     { std::cout << "  복사 생성자\n"; }
    Counted(Counted&&) noexcept { std::cout << "  이동 생성자\n"; }
};

int main() {
    Counted original;

    std::cout << "-- auto copy = original; --\n";
    auto copy = original;

    std::cout << "-- auto& ref = original; --\n";
    auto& ref = original;

    std::cout << "-- const auto& cref = original; --\n";
    const auto& cref = original;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra auto_strips_ref.cpp -o auto_strips_ref
$ ./auto_strips_ref
  기본 생성자
-- auto copy = original; --
  복사 생성자
-- auto& ref = original; --
-- const auto& cref = original; --
```

`auto copy = original;` 줄에서만 `복사 생성자`가 찍혔다. `auto&`와 `const auto&`는 아무것도 찍지 않았다 — 복사가 일어나지 않았다는 뜻이다. `auto`가 타입을 추론할 때는 레퍼런스 자격과 최상위 `const`를 벗기고 "값 타입"만 남긴다. 그래서 `original`이 아무리 큰 객체라도 `auto x = original;`은 그 크기만큼 복사한다. **큰 객체를 다룰 때는 `auto`가 기본값이 아니라 `auto&` 또는 `const auto&`가 기본값이어야 한다.**

### 범위 기반 for에서 이 함정은 반복문 전체를 느리게 만든다

이 습관의 차이는 루프 하나로 끝나지 않는다. 컨테이너를 도는 매 반복마다 복사가 일어나므로, 원소가 크거나 복사 비용이 있으면(문자열, 벡터, 큰 구조체) 전체 실행 시간에 실측 가능한 차이를 남긴다.

```cpp title="rangefor_string.cpp"
#include <chrono>
#include <string>
#include <vector>

int main() {
    constexpr int N = 500'000;
    // SSO(짧은 문자열 최적화) 버퍼보다 긴 문자열 — 복사할 때마다 힙 할당이 일어난다
    std::vector<std::string> names(N, std::string("joint_position_controller_states_frame_id"));

    std::size_t len_copy = 0;
    auto t0 = std::chrono::steady_clock::now();
    for (auto s : names) {                  // 값으로 — 매 반복 힙 할당 + 복사
        len_copy += s.size();
    }
    auto t1 = std::chrono::steady_clock::now();

    std::size_t len_ref = 0;
    for (const auto& s : names) {           // 참조 — 할당 없음
        len_ref += s.size();
    }
    auto t2 = std::chrono::steady_clock::now();
    // ... 두 구간의 시간을 밀리초로 출력
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 rangefor_string.cpp -o rangefor_string
$ ./rangefor_string
len_copy = 20500000, len_ref = 20500000
복사(auto)  : 9.61316 ms
참조(auto&) : 1.63875 ms
```

(g++ 13 / `-O2` / Linux x86-64, 50만 개 원소 실측. 절대 시간은 기기마다 다르지만 배율은 이 구조에서 안정적으로 재현된다.) `auto`로 돈 루프가 `const auto&`로 돈 루프보다 약 **6배** 느렸다. 원소 개수만큼 문자열을 힙에 새로 할당하고 복사한 뒤 루프 스코프가 끝날 때 해제하는 비용이다. 두 루프 다 `s.size()`만 읽었을 뿐 값을 바꾸지 않았으니 복사는 애초에 필요가 없었다. `const auto&`가 [1.5](#/control-flow)에서 본 범위 기반 for의 기본 습관이어야 하는 이유가 이 실측 하나로 요약된다 — **읽기만 한다면 항상 `const auto&`, 바꿀 계획이 있을 때만 `auto&`, 원소가 원시 타입 하나뿐이고 복사 비용이 없다고 확신할 때만(예: `int`, `double`) `auto`를 예외로 허용해라.**

::: perf 왜 배율이 정확히 재현되는가
이 벤치마크가 보여 주는 건 "복사가 이론적으로 느리다"가 아니라 **할당자 호출 비용**이다. `std::string`이 SSO 버퍼(대개 15~22바이트)보다 긴 문자열을 복사하면 `new`를 거쳐 힙에 새 버퍼를 잡아야 한다 — [2.4 new/delete와 동적 할당의 비용](#/dynamic-alloc)에서 그 한 번의 비용을 마이크로초 단위로 재는 법을 다룬다. 참조로 도는 루프는 이 호출 자체가 아예 일어나지 않으므로, 배율은 "메모리 접근 패턴의 차이"가 아니라 "할당기 호출 횟수의 차이"에서 나온다.
:::

## 로보틱스 도메인: 레퍼런스가 실제로 나타나는 자리

rclcpp의 구독 콜백 시그니처는 거의 예외 없이 `const T::SharedPtr&` 혹은 `const T&` 형태다. 예를 들어 `void on_twist(const geometry_msgs::msg::Twist& msg)` — 매 콜백 호출마다 메시지 전체를 복사하지 않겠다는 뜻이고, 콜백이 메시지를 수정할 이유가 없다는 뜻이며, 콜백 안에서 `msg`가 유효하지 않을 리 없다는 뜻이다. 이 셋 전부가 이 절에서 다룬 `const&`의 성질 그대로다. rclcpp가 이 시그니처를 강제하는 게 아니라 **이 절이 설명한 이유 때문에 관례가 자연스럽게 이렇게 굳었다.**

반대로 조심할 자리도 있다. [9.1 Eigen](#/eigen)에서 자세히 다루겠지만, `Eigen`의 행렬 곱셈 `A * B`는 결과 행렬이 아니라 **아직 계산되지 않은 표현식 객체**를 돌려준다. 이걸 `auto`로 받으면 — 이 절에서 방금 "auto는 복사라 안전하다"고 배운 감각으로 — 실제로는 원본 행렬이 이미 사라진 뒤에 계산되는 표현식을 붙잡아 두는 꼴이 되어 잘못된 결과나 댕글링을 부른다. `auto`가 항상 안전한 복사라는 이 절의 직관은 일반 타입에서나 맞고, 표현식 템플릿 앞에서는 뒤집힌다 — 그 함정은 9.1에서 실측한다.

::: interview 포인터 vs 레퍼런스
"포인터와 레퍼런스의 차이를 설명하라"는 C++ 면접에서 가장 자주 나오는 질문이다. 답변 뼈대: ① **구현 관점**에서는 둘 다 대개 간접 참조로 컴파일된다 — 레퍼런스도 인자로 넘어갈 때는 주소를 싣는다(이 절의 `deep` 상자 참고). ② **의미 관점**이 진짜 차이다 — 레퍼런스는 재바인딩이 없고(`r = y`는 대입이지 재바인딩이 아님, 이 절의 실측), 널이 없으며(정의상 항상 유효한 별명), 소유의 의미가 없다(레퍼런스는 자원 해제를 책임지지 않는다). 포인터는 셋 다 허용한다 — 다시 가리킬 수 있고, `nullptr`로 "없음"을 표현하고, 스마트 포인터와 짝지어 소유를 표현한다. ③ 그래서 선택 기준은 "간접 참조가 필요한가"가 아니라 "재바인딩·널·소유 중 하나라도 필요한가"다 — 이 절의 선택 기준 표를 그대로 말하면 된다. 상급 답변은 여기에 "레퍼런스 멤버가 있으면 복사 대입이 암묵적으로 삭제된다"(이 절에서 실측)까지 붙인다 — 왜 클래스 설계에서는 레퍼런스 멤버를 신중히 써야 하는지까지 짚는 답이 된다.
:::

## 요약

- 레퍼런스는 원본의 별명이다 — `&r == &x`, `sizeof(r) == sizeof(x)`가 항상 성립한다(실측). "레퍼런스 자신"은 관찰할 방법이 없다.
- `r = y`는 재바인딩이 아니라 **대입**이다 — `x`의 값이 바뀔 뿐 `r`은 여전히 `x`의 별명이다(실측: `&r == &x`는 대입 후에도 true).
- 레퍼런스는 반드시 초기화해야 하고(초기화 없는 선언은 컴파일 에러), 비`const` 레퍼런스는 lvalue에만 바인딩된다(rvalue 전달은 컴파일 에러). `const&`는 예외로 임시값을 받고, 그 임시값의 수명을 레퍼런스의 수명까지 연장한다(실측: 소멸자가 함수 끝에서 호출됨).
- 댕글링 레퍼런스는 포인터와 같은 방식으로 생긴다 — 지역 변수 반환(세그폴트 실측), 컨테이너 재할당으로 인한 무효화(`heap-use-after-free` 실측). 원소를 재배치하는 연산 앞에서는 떠 둔 레퍼런스를 전부 무효로 취급해라.
- 재바인딩·널·소유 중 하나라도 필요하면 포인터(혹은 스마트 포인터), 그 외 단순 별명은 레퍼런스. 클래스의 레퍼런스 멤버는 복사 대입을 암묵적으로 삭제시킨다(실측).
- `auto`는 레퍼런스와 최상위 `const`를 벗기고 복사를 만든다(실측: 복사 생성자 호출). 범위 기반 for에서 `auto` 대신 `const auto&`를 기본값으로 삼아라 — 큰 원소에서는 실측으로 6배 차이가 난다.

::: quiz 연습문제
1~2번은 개념 문제, 3번은 예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. "레퍼런스는 포인터의 문법만 다른 버전이다"라는 주장에 반박하라. 이 절에서 실측한 근거를 최소 두 가지 들어라.

2. 다음 클래스에 레퍼런스 멤버를 넣으면 컴파일러가 자동으로 만들던 어떤 특수 멤버 함수가 삭제되는가? 그리고 왜 삭제되는 것이 "적당히 동작하게 두는 것"보다 나은 선택인가?

   ```cpp
   struct Sensor {
       int& reading;
   };
   ```

3. 다음 코드의 `소멸` 로그가 몇 번째 줄 다음에 찍힐지 예측하라. 컴파일하지 말고 먼저 답을 써라.

   ```cpp
   struct Loud { ~Loud() { std::cout << "소멸\n"; } };
   Loud make() { return Loud(); }

   int main() {
       std::cout << "1\n";
       const Loud& r = make();
       std::cout << "2\n";
       std::cout << "3\n";
   }   // <- 여기?
   ```

4. (실습) 이 절의 `lifetime_ext.cpp`를 직접 쳐서, `const Big&` 대신 `Big&&`(rvalue 레퍼런스)로 받았을 때도 같은 수명 연장이 일어나는지 확인하라. 성공 기준: 두 경우 모두 `Big 소멸`이 `main` 끝에서 찍힌다.

5. (실습) `rangefor_string.cpp`를 직접 쳐서 6배 배율을 재현하라. 그다음 문자열 길이를 SSO 버퍼 안에 들어가는 짧은 문자열(예: `"short"`)로 바꿔서 다시 재고, 배율이 크게 줄어드는 것을 확인하라. 성공 기준: 긴 문자열에서는 배율이 크고, 짧은 문자열에서는 배율이 1에 가깝게 좁혀진다 — SSO가 힙 할당 자체를 없앴기 때문이다.
:::

::: answer 해설
1. 근거 예: ① `r = y`는 재바인딩이 아니라 대입이다(포인터라면 `p = &y`로 가리키는 대상이 바뀌지만, 레퍼런스는 원본 값만 바뀐다) — 순수 문법 차이가 아니라 의미론이 다르다. ② 레퍼런스는 널이 원천적으로 금지되고 반드시 초기화해야 한다 — 포인터에는 없는 언어 차원의 제약이다. ③ 클래스 멤버로 넣으면 복사 대입이 삭제된다 — 포인터 멤버에는 없는 결과다.
2. 복사 대입 연산자(`operator=`)가 삭제된다. 이유: 대입은 재바인딩이 아니므로 `s1 = s2`가 `reading`을 복사하려면 "가리키는 원본에 값을 대입"해야 하는데, 이는 대입 전후로 `s1`과 `s2`가 서로 다른 원본을 참조하는 관계를 그대로 남긴다 — 애매하게 절반만 동작하느니 컴파일러가 아예 거부하는 편이 버그를 예방한다.
3. `3` 다음, `main`이 끝나는 지점(주석 표시된 줄 직전)이다. `const Loud& r = make();`가 임시 `Loud`의 수명을 `r`의 수명(main 블록 끝)까지 늘리기 때문에, `2`와 `3`이 다 찍힌 뒤에야 `소멸`이 나온다. 본문 `lifetime_ext.cpp`의 실측과 같은 패턴이다.
4. 실측 기준: `Big&&`로 받아도 똑같이 `Big 소멸`이 `main` 끝에서 찍힌다. 수명 연장은 `const&`만의 특권이 아니라 "임시값을 레퍼런스에 바인딩하는 모든 경우"에 적용되는 규칙이다 — rvalue 레퍼런스는 [2.7 이동 시맨틱](#/move-semantics)에서 본격적으로 다룬다.
5. 본문 실측(50만 개, `-O2`)에서 긴 문자열은 약 6배(9.6ms vs 1.6ms) 차이가 났다. `"short"`처럼 SSO 버퍼(대개 15바이트 안팎) 안에 들어가는 문자열로 바꾸면 복사가 힙 할당 없이 스택 안에서 끝나므로, 두 루프의 시간 차이가 크게 좁혀져야 한다 — 정확한 배율은 기기·libstdc++ 버전마다 다르지만 "짧은 문자열에서는 격차가 준다"는 방향은 재현된다.
:::

이 절의 코드는 전부 짧다. 직접 쳐라. 특히 `rebind.cpp`와 `lifetime_ext.cpp`는 예측 → 실행 → 비교로, `dangling_return.cpp`와 `vec_invalidate.cpp`는 반드시 ASan까지 붙여서 돌려라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [2.4 new/delete와 동적 할당의 비용](#/dynamic-alloc) — 레퍼런스는 이미 존재하는 객체의 별명일 뿐, 객체를 만들지는 않는다. 그 객체가 힙에서 태어나는 과정과, 그 과정의 실제 비용으로 간다.

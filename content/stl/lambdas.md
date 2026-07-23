# 5.6 람다와 클로저

::: lead
[4.7](#/type-deduction)에서 "반복자나 람다의 타입은 이름조차 없다"고 스쳐 지나갔다. 그 말을 그대로 믿고 넘어가면 위험하다 — "이름이 없다"는 "타입이 없다"는 뜻이 아니라, **컴파일러가 그 자리에서 즉석으로 클래스를 하나 만들고 이름을 안 붙였을 뿐**이라는 뜻이다. `[x, &y](int n) { return x + y + n; }`을 보고 "함수 하나"라고 생각하면 캡처가 왜 원본을 붙잡기도 하고 스냅샷을 뜨기도 하는지, `mutable`이 왜 필요한지, 캡처한 객체가 왜 댕글링을 만드는지 전부 암기로 넘어가야 한다. 이 절은 그 암기를 없앤다 — 람다가 정확히 어떤 클래스의 인스턴스인지, 캡처가 그 클래스의 무엇으로 저장되는지를 `sizeof`와 `typeid`로 직접 파헤친다.
:::

## "람다는 함수 아닌가?" — typeid로 반박한다

`auto add = [](int a, int b) { return a + b; };`를 처음 보면 이름 없는 함수를 변수에 담은 것처럼 보인다. 그런데 `add(2, 3)`이라는 호출 문법 뒤에는 실제로 `add.operator()(2, 3)`이라는 멤버 함수 호출이 숨어 있다 — `add`가 함수가 아니라 **`operator()`를 가진 객체**라는 뜻이다.

```cpp title="lambda_is_class.cpp — 람다를 클래스 인스턴스로 다뤄본다"
#include <iostream>
#include <type_traits>
#include <typeinfo>

int main() {
    auto add = [](int a, int b) { return a + b; };

    // 람다는 이름 없는 클래스의 인스턴스다 -- operator() 를 통해 호출된다.
    std::cout << "add(2, 3) = " << add(2, 3) << "\n";
    std::cout << "add(2, 3) 대신 add.operator()(2, 3) = " << add.operator()(2, 3) << "\n";

    // 클래스인지 확인 -- is_class_v가 참이어야 "람다 == 이름 없는 클래스"가 증명된다.
    static_assert(std::is_class_v<decltype(add)>, "클로저 타입은 클래스여야 한다");
    std::cout << "std::is_class_v<decltype(add)> = " << std::is_class_v<decltype(add)> << "\n";

    // 같은 시그니처의 람다 두 개는 서로 다른 타입이다 -- 정의된 지점마다 새 클래스가 나온다.
    auto add2 = [](int a, int b) { return a + b; };
    static_assert(!std::is_same_v<decltype(add), decltype(add2)>,
                  "시그니처가 같아도 서로 다른 클로저 타입이다");
    std::cout << "std::is_same_v<decltype(add), decltype(add2)> = "
              << std::is_same_v<decltype(add), decltype(add2)> << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_is_class.cpp -o lambda_is_class
$ ./lambda_is_class
add(2, 3) = 5
add(2, 3) 대신 add.operator()(2, 3) = 5
std::is_class_v<decltype(add)> = 1
std::is_same_v<decltype(add), decltype(add2)> = 0
```

(g++ 13.3 실측.) `add.operator()(2, 3)`이 컴파일된다는 것 자체가 `add`에 진짜 멤버 함수 `operator()`가 있다는 증거다. `static_assert`가 통과했으니 `decltype(add)`는 진짜 클래스 타입이고, `add`와 `add2`가 **글자 하나 다르지 않은 같은 코드**로 정의됐는데도 서로 다른 타입이라는 사실은 컴파일러가 **람다 표현식이 나타나는 지점마다 새 클래스를 하나씩 찍어낸다**는 걸 보여준다. 이 익명 클래스와 그 인스턴스를 이 책에서는 각각 **클로저 타입**, **클로저 객체**라고 부른다.

이 익명 타입의 실체를 `typeid`로 한 번 더 확인해 본다. 맹글링된 이름은 사람이 읽으라고 만든 문자열이 아니지만, `abi::__cxa_demangle`로 풀면 컴파일러가 내부적으로 어떤 이름을 붙였는지가 드러난다.

```cpp title="lambda_demangle.cpp — typeid(add).name()을 사람이 읽을 수 있게 풀어본다"
#include <cxxabi.h>
#include <iostream>
#include <memory>
#include <typeinfo>

// __cxa_demangle이 리턴하는 malloc 버퍼를 자동 해제하기 위한 작은 헬퍼.
std::string demangle(const char* mangled) {
    int status = 0;
    std::unique_ptr<char, void(*)(void*)> buf(
        abi::__cxa_demangle(mangled, nullptr, nullptr, &status), std::free);
    return (status == 0 && buf) ? buf.get() : mangled;
}

int main() {
    auto add = [](int a, int b) { return a + b; };
    auto add2 = [](int a, int b) { return a + b; };

    std::cout << "add  raw : " << typeid(add).name() << "\n";
    std::cout << "add  풀이: " << demangle(typeid(add).name()) << "\n";
    std::cout << "add2 raw : " << typeid(add2).name() << "\n";
    std::cout << "add2 풀이: " << demangle(typeid(add2).name()) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_demangle.cpp -o lambda_demangle
$ ./lambda_demangle
add  raw : Z4mainEUliiE_
add  풀이: main::{lambda(int, int)#1}
add2 raw : Z4mainEUliiE0_
add2 풀이: main::{lambda(int, int)#2}
```

(g++ 13.3 실측 — 맹글링 문자열 자체는 구현마다 다를 수 있는 ABI 세부사항이지만, "람다마다 별도 타입이 나온다"는 결론은 구현과 무관하다.) 풀어낸 이름 `main::{lambda(int, int)#1}`과 `#2`가 결정적이다 — g++는 `main` 안에서 몇 번째 람다인지를 타입 이름에 새겨 넣는다. `add`와 `add2`는 소스 코드가 완전히 같지만 서로 다른 람다 표현식에서 나왔기 때문에 별개의 클래스가 된다. 함수 템플릿이 호출될 때마다 별도 코드를 찍어내는 것([4.1](#/function-templates)~[4.3](#/template-mechanics))과 원리는 다르지만 결과는 닮았다 — **람다 표현식은 코드가 아니라 "그 자리에서 클래스 정의 하나를 실행하는 것"**이다.

::: deep 왜 이름을 안 붙이는가
클로저 타입에 이름을 붙이지 않는 건 언어가 게을러서가 아니다. 람다가 등장하는 자리(주로 알고리즘의 콜백 인자, 지역 변수의 초기화식)는 애초에 그 타입의 이름을 다른 코드가 알 필요가 없는 자리다. 이름이 없으면 그 타입은 오직 `auto`나 템플릿 인자 추론으로만 가리킬 수 있고([4.7](#/type-deduction)), 이게 오히려 캡슐화에 가깝다 — 이 람다의 타입이 정확히 무엇인지 신경 쓰지 말고 "호출 가능한 무언가"로만 다루라는 설계 의도다. `std::function`(다음 절)이 그 "무언가"를 타입 이름과 무관하게 담기 위한 장치다.
:::

## 캡처는 멤버 변수다 — sizeof로 확인한다

클로저가 클래스라면, 캡처한 변수는 그 클래스의 어딘가에 저장돼야 한다. 저장되는 자리는 정확히 하나다 — **클로저 클래스의 멤버 변수**. 캡처 목록에 변수를 하나씩 추가할 때마다 `sizeof(람다)`가 그 변수의 타입 크기만큼 늘어나는지 실측하면 이 사실이 바로 드러난다.

```cpp title="lambda_sizeof.cpp — 캡처 개수·방식에 따라 sizeof가 바뀐다"
#include <iostream>

struct Big3 { double a, b, c; };  // 24바이트짜리 캡처 대상

int main() {
    int x = 1;
    int y = 2;
    double z = 3.0;
    Big3 big{1.0, 2.0, 3.0};

    auto empty_cap   = []() { return 0; };
    auto one_int      = [x]() { return x; };
    auto two_ints     = [x, y]() { return x + y; };
    auto one_ref      = [&x]() { return x; };
    auto mixed        = [x, &y, z]() { return x + y + z; };
    auto by_value_big = [big]() { return big.a; };
    auto by_ref_big   = [&big]() { return big.a; };

    std::cout << "sizeof(빈 캡처)                = " << sizeof(empty_cap)   << " bytes\n";
    std::cout << "sizeof([x])                    = " << sizeof(one_int)     << " bytes\n";
    std::cout << "sizeof([x, y])                 = " << sizeof(two_ints)    << " bytes\n";
    std::cout << "sizeof([&x])                   = " << sizeof(one_ref)     << " bytes\n";
    std::cout << "sizeof([x, &y, z])              = " << sizeof(mixed)      << " bytes\n";
    std::cout << "sizeof([big]) (Big3 값 캡처)    = " << sizeof(by_value_big) << " bytes\n";
    std::cout << "sizeof([&big]) (Big3 레퍼런스)  = " << sizeof(by_ref_big) << " bytes\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_sizeof.cpp -o lambda_sizeof
$ ./lambda_sizeof
sizeof(빈 캡처)                = 1 bytes
sizeof([x])                    = 4 bytes
sizeof([x, y])                 = 8 bytes
sizeof([&x])                   = 8 bytes
sizeof([x, &y, z])              = 24 bytes
sizeof([big]) (Big3 값 캡처)    = 24 bytes
sizeof([&big]) (Big3 레퍼런스)  = 8 bytes
```

(g++ 13.3 / x86-64 실측.) 전부 앞 절들에서 이미 배운 크기 규칙 그대로다. 캡처가 아예 없는 람다는 `sizeof`가 **1바이트**다 — 멤버가 없는 빈 클래스도 서로 다른 두 객체가 같은 주소를 갖지 않도록 최소 1바이트는 차지한다([2.12 객체 레이아웃](#/object-layout)). `int` 하나를 값으로 캡처하면 정확히 `sizeof(int)`인 4바이트가 늘고, 두 개면 8바이트다. **레퍼런스 캡처 `[&x]`는 `int`(4바이트)가 아니라 8바이트다** — 레퍼런스는 내부적으로 포인터로 구현되고, x86-64에서 포인터는 8바이트이기 때문이다([2.3 레퍼런스](#/references)). `[x, &y, z]`는 `int`(4)+레퍼런스(8)+`double`(8)=20바이트가 될 것 같지만 실제로는 24바이트다 — `double` 멤버가 8바이트 정렬을 요구해서 앞에 4바이트 패딩이 끼어든다(같은 패딩 규칙이 클로저 클래스에도 적용된다).

가장 중요한 대비는 마지막 두 줄이다. `Big3`(24바이트)를 값으로 캡처하면 클로저도 24바이트로 불어나지만, **레퍼런스로 캡처하면 원본이 몇 바이트든 상관없이 클로저는 항상 8바이트**다. 캡처가 "변수를 멤버로 저장한다"는 규칙 하나로 값 캡처와 레퍼런스 캡처의 비용 차이, 그리고 다음 절에서 볼 두 캡처의 동작 차이까지 전부 설명된다.

```text nolines
값 캡처 [x, &y, z]의 클로저 객체 (개념도, 실제 멤버 이름은 컴파일러가 정한다)

  class __lambda_N {
      int    x_;      // 값 캡처 -- x의 복사본
      int&   y_;      // 레퍼런스 캡처 -- y를 가리키는 참조(포인터로 구현)
      double z_;      // 값 캡처 -- z의 복사본
  public:
      auto operator()() const { return x_ + y_ + z_; }
  };
```

::: note 캡처 목록이 비어 있으면 함수 포인터로도 변환된다
캡처를 아무것도 안 한 람다(`[]`)는 상태를 담을 멤버가 없으므로, 클로저 클래스가 암묵적으로 평범한 함수 포인터로 변환하는 연산자(`operator T(*)(Args...)`)를 하나 더 갖는다. 그래서 `void (*fp)(int) = [](int n) { std::cout << n; };`처럼 C 스타일 콜백을 요구하는 API(예: `qsort`의 비교 함수, C로 된 레거시 콜백 등록 함수)에 캡처 없는 람다를 그대로 넘길 수 있다. 캡처가 하나라도 있으면 이 변환은 사라진다 — 상태를 담을 자리가 함수 포인터에는 없기 때문이다.
:::

## 값 캡처는 스냅샷, 레퍼런스 캡처는 별명

캡처가 멤버 변수라는 사실을 알면 `[=]`(값 캡처)와 `[&]`(레퍼런스 캡처)의 동작 차이가 새삼스럽지 않다. 값 캡처는 **캡처가 실행되는 순간의 값을 멤버에 복사**하고, 그 뒤로 원본이 바뀌어도 멤버는 그대로다. 레퍼런스 캡처는 원본을 가리키는 참조를 멤버에 담으므로, 원본이 바뀌면 그 변화가 그대로 보인다.

```cpp title="lambda_snapshot.cpp — 캡처 이후 원본을 바꿔본다"
#include <iostream>

int main() {
    int counter = 10;

    auto by_value = [counter]() { return counter; };  // 캡처 "시점"의 값을 멤버로 복사해 둔다
    auto by_ref   = [&counter]() { return counter; }; // counter 자체를 참조한다

    counter = 999;  // 캡처가 끝난 뒤 원본을 바꾼다

    std::cout << "원본 counter        = " << counter << "\n";
    std::cout << "by_value()          = " << by_value() << "  (캡처 시점 스냅샷, 안 바뀐다)\n";
    std::cout << "by_ref()            = " << by_ref()   << "  (원본을 그대로 참조, 바뀐다)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_snapshot.cpp -o lambda_snapshot
$ ./lambda_snapshot
원본 counter        = 999
by_value()          = 10  (캡처 시점 스냅샷, 안 바뀐다)
by_ref()            = 999  (원본을 그대로 참조, 바뀐다)
```

(g++ 13.3 실측.) `by_value`는 람다가 **정의되는 줄**에서 `counter`의 값 `10`을 멤버에 복사해 뒀기 때문에, 그 이후 원본이 `999`로 바뀌어도 여전히 `10`을 돌려준다. `by_ref`는 `counter` 자체에 대한 참조를 멤버에 담고 있어서 원본의 변화를 그대로 따라간다. `[=]`, `[&]`처럼 캡처 목록에 아무 이름도 안 쓰고 기본 캡처 모드만 쓰면 본문에서 실제로 쓰는 모든 바깥 변수가 이 규칙대로 각각 값/레퍼런스로 캡처된다 — 개별 이름을 나열하는 `[x]`, `[&x]`와 동작 자체는 같고, 어떤 변수를 캡처할지가 암묵적이냐 명시적이냐만 다르다.

## 댕글링 레퍼런스 캡처: 원본이 먼저 죽으면

레퍼런스 캡처의 "별명"이라는 성질은 원본의 수명이 클로저 객체보다 짧아지는 순간 위험해진다. 별명은 원본이 있어야 의미가 있는데, 함수의 지역 변수를 레퍼런스로 캡처한 람다를 그 함수 밖으로 들고 나오면 정확히 이 상황이 재현된다.

```cpp title="lambda_dangle.cpp — 지역 변수를 참조 캡처한 람다를 함수 밖으로 반환한다"
#include <functional>
#include <iostream>

// 지역 변수를 레퍼런스로 캡처한 람다를 std::function에 담아 "밖으로" 들고 나온다.
// 함수가 끝나면 지역 변수는 스택에서 사라지지만, 람다는 그 변수의 참조를 여전히 쥐고 있다.
std::function<int()> make_dangling_callback() {
    int local_value = 42;                 // 이 함수가 끝나면 사라질 지역 변수
    auto callback = [&local_value]() {    // 레퍼런스 캡처 -- local_value의 "주소"를 그대로 붙잡는다
        return local_value * 2;
    };
    return callback;   // callback을 반환하는 순간 local_value는 이미 소멸 대상이다
}

int main() {
    auto cb = make_dangling_callback();  // make_dangling_callback의 스택 프레임은 여기서 이미 정리됐다
    std::cout << "콜백 호출 결과 = " << cb() << "\n";  // 죽은 스택 메모리를 읽는다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g lambda_dangle.cpp -o lambda_dangle
$ ./lambda_dangle
==28815==ERROR: AddressSanitizer: stack-use-after-return on address 0x7f81984000b0 at pc 0x55c0cf0563b5 bp 0x7ffe04c129e0 sp 0x7ffe04c129d0
READ of size 4 at 0x7f81984000b0 thread T0
    #0 0x55c0cf0563b4 in operator() lambda_dangle.cpp:9
    #1 0x55c0cf056c19 in __invoke_impl<int, make_dangling_callback()::<lambda()>&> /usr/include/c++/13/bits/invoke.h:61
    ...
    #4 0x55c0cf056f39 in std::function<int ()>::operator()() const /usr/include/c++/13/bits/std_function.h:591
    #5 0x55c0cf05666e in main lambda_dangle.cpp:16

Address 0x7f81984000b0 is located in stack of thread T0 at offset 48 in frame
    #0 0x55c0cf0563ca in make_dangling_callback() lambda_dangle.cpp:6
  This frame has 2 object(s):
    [48, 52) 'local_value' (line 7) <== Memory access at offset 48 is inside this variable
    [64, 72) 'callback' (line 8)
SUMMARY: AddressSanitizer: stack-use-after-return lambda_dangle.cpp:9 in operator()
```

(g++ 13.3 / ASan 실측 — 스택 트레이스는 핵심 줄만 남기고 축약했다.) ASan이 정확히 짚는다 — 문제의 주소는 `make_dangling_callback`의 스택 프레임 안, `local_value`가 있던 자리(`offset 48`)다. `callback`이 `std::function`에 담겨 `main`으로 반환됐을 땐 이미 그 프레임이 함수 반환과 함께 무효화된 뒤였다("stack-use-after-**return**" — [2.11 댕글링과 UB](#/ub-sanitizers)의 스코프 이탈 참조와 같은 계열이지만, 이번엔 "함수 반환"이 트리거라 리포트 이름이 다르다). `cb()`가 `local_value * 2`를 계산하려는 순간, 그 계산에 필요한 `local_value`는 더 이상 존재하지 않는 메모리다.

::: danger 레퍼런스 캡처는 클로저보다 원본이 오래 살아야만 안전하다
값 캡처가 항상 안전한 건 아니다(다음다음 절에서 볼 `mutable`의 원본 불변 성질과 별개로, 값 캡처도 캡처 시점에 이미 소멸한 객체를 복사하려 들면 UB다). 그러나 실전에서 압도적으로 많이 나오는 함정은 레퍼런스 캡처다 — **람다가 저장되어 나중에, 다른 스코프에서 호출될 가능성이 있다면 레퍼런스 캡처는 원본의 수명을 반드시 클로저 객체의 수명보다 길게 보장해야 한다.** 콜백을 등록하고 즉시 그 자리에서만 쓰는 경우(`std::sort`의 비교자처럼 즉시 소비되는 람다)는 안전하다. 콜백을 어딘가에 저장해 두고 나중에 부르는 경우(이 절의 `std::function`, 다음 절에서 다룰 콜백 등록 패턴)는 위험하다.
:::

## mutable: 값 캡처를 손대려면

값 캡처는 클로저의 멤버에 원본의 **복사본**을 저장한다. 그런데 클로저의 `operator()`는 기본적으로 `const` 멤버 함수로 만들어진다 — `operator()` 안에서 그 복사본조차 못 바꾼다는 뜻이다. `mutable` 키워드가 이 `const`를 벗겨서 값 캡처 멤버를 본문에서 고칠 수 있게 해 준다.

```cpp title="lambda_mutable_error.cpp — mutable 없이 값 캡처를 고치려 하면 막힌다"
int main() {
    int count = 0;
    auto broken = [count]() { count++; return count; };  // mutable 없이 값 캡처를 수정하려 한다
    return broken();
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_mutable_error.cpp -o lambda_mutable_error
lambda_mutable_error.cpp: In lambda function:
lambda_mutable_error.cpp:3:31: error: increment of read-only variable 'count'
    3 |     auto broken = [count]() { count++; return count; };  // mutable 없이 값 캡처를 수정하려 한다
      |                               ^~~~~
```

(g++ 13.3 실측.) `count`가 `int`인데도 "read-only variable"이라고 거부하는 이유는 정확히 앞서 말한 것 — `operator() const`가 그 멤버를 `const int`처럼 취급하기 때문이다. `mutable`을 붙이면 `operator()`가 `const`를 잃고, 값 캡처 멤버를 자유롭게 바꿀 수 있다.

```cpp title="lambda_mutable.cpp — mutable로 값 캡처 멤버를 고친다"
#include <iostream>

int main() {
    int count = 0;

    auto with_mutable = [count]() mutable {
        count++;           // mutable 덕분에 "복사본" count를 고칠 수 있다
        return count;
    };

    std::cout << "with_mutable() 1회차 = " << with_mutable() << "\n";
    std::cout << "with_mutable() 2회차 = " << with_mutable() << "\n";
    std::cout << "with_mutable() 3회차 = " << with_mutable() << "\n";
    std::cout << "원본 count           = " << count << "  (원본은 전혀 안 바뀌었다)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_mutable.cpp -o lambda_mutable
$ ./lambda_mutable
with_mutable() 1회차 = 1
with_mutable() 2회차 = 2
with_mutable() 3회차 = 3
원본 count           = 0  (원본은 전혀 안 바뀌었다)
```

(g++ 13.3 실측.) 흥미로운 지점이 두 개다. 첫째, 세 번 부르는 동안 `1, 2, 3`으로 누적된다 — 클로저 객체 하나가 자신의 멤버 `count`에 상태를 그대로 유지한다는 뜻이다. 둘째, 그렇게 값이 바뀌었는데도 **원본 `count`는 여전히 `0`이다** — `mutable`이 허용하는 건 "클로저가 들고 있는 복사본을 고치는 것"이지 "원본에 다시 써 넣는 것"이 아니다.

::: warn mutable과 레퍼런스 캡처를 혼동하지 마라
원본을 실제로 바꾸고 싶다면 애초에 `mutable`이 아니라 레퍼런스 캡처(`[&count]`)를 써야 한다. `mutable`은 값 캡처를 전제로 "클로저 내부 복사본"에 대한 쓰기 권한을 여는 것이고, 레퍼런스 캡처는 처음부터 원본을 가리키므로 `mutable` 없이도(그리고 그 어떤 `const` 제약과도 무관하게) 원본을 바꾼다. 둘은 완전히 다른 문제에 대한 답이다.
:::

## C++14 init capture: 복사 못 하는 자원을 이동시켜 캡처한다

`[unique_owned]`처럼 이름만 나열하는 캡처는 **복사 생성자를 부른다.** `std::unique_ptr`처럼 복사 생성자가 아예 `delete`된 타입([2.9 unique_ptr](#/unique-ptr))은 이 방식으로 캡처할 수조차 없다.

```cpp title="lambda_init_capture_error.cpp — unique_ptr를 이름만으로 캡처하면 막힌다"
#include <memory>

int main() {
    auto original = std::make_unique<int>(77);
    auto broken = [original]() { return *original; };  // unique_ptr는 복사 생성자가 없다
    return broken();
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_init_capture_error.cpp -o lambda_init_capture_error
lambda_init_capture_error.cpp: In function 'int main()':
lambda_init_capture_error.cpp:5:19: error: use of deleted function 'std::unique_ptr<_Tp, _Dp>::unique_ptr(const std::unique_ptr<_Tp, _Dp>&) [with _Tp = int; _Dp = std::default_delete<int>]'
    5 |     auto broken = [original]() { return *original; };  // unique_ptr는 복사 생성자가 없다
      |                   ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

(g++ 13.3 실측.) C++14가 추가한 **초기화 캡처(init capture, 일반화된 캡처라고도 부른다)**는 캡처 목록에 `이름 = 표현식` 형태를 허용해서 이 문제를 없앤다 — 클로저 클래스에 `이름`이라는 새 멤버를 만들고, 그 초기값을 `표현식`으로 정확히 지정하는 문법이다. `표현식` 자리에 `std::move(original)`을 쓰면 복사가 아니라 **이동**으로 그 멤버를 초기화한다.

```cpp title="lambda_init_capture.cpp — std::move로 unique_ptr를 클로저 안으로 이동시킨다"
#include <iostream>
#include <memory>
#include <utility>

int main() {
    auto original = std::make_unique<int>(77);   // unique_ptr -- 복사 불가, 이동만 가능
    std::cout << "이동 전 original.get() = " << original.get() << "\n";

    // 일반 값 캡처 [original]는 컴파일이 안 된다 -- unique_ptr는 복사 생성자가 없다.
    // C++14 init capture로 "새 멤버 owned = std::move(original)"을 만든다.
    auto holder = [owned = std::move(original)]() {
        std::cout << "람다 내부 owned.get()  = " << owned.get()
                  << "  (*owned = " << *owned << ")\n";
    };

    std::cout << "이동 후 original.get() = " << original.get() << "  (moved-from, nullptr)\n";
    holder();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_init_capture.cpp -o lambda_init_capture
$ ./lambda_init_capture
이동 전 original.get() = 0x5627d64d82b0
이동 후 original.get() = 0  (moved-from, nullptr)
람다 내부 owned.get()  = 0x5627d64d82b0  (*owned = 77)
```

(g++ 13.3 실측 — 포인터 값 자체는 실행마다 ASLR로 다르지만 "같은 주소가 owned로 넘어갔다"는 상대적 사실은 그대로다.) `owned`는 `original`이 들고 있던 힙 블록(`0x5627d64d82b0`)을 그대로 넘겨받았고, `original`은 [2.7 이동 시맨틱](#/move-semantics)의 규칙대로 `nullptr`인 moved-from 상태가 됐다. init capture의 우변에는 `std::move`뿐 아니라 임의의 표현식을 쓸 수 있다 — `[half = x / 2]`처럼 캡처 시점에 새 값을 계산해 저장하는 것도 가능하다.

## 제네릭 람다: operator()에 템플릿이 생긴다 (C++14)

캡처가 아니라 **파라미터**에 `auto`를 쓰면 완전히 다른 이야기가 시작된다. `[](auto a, auto b) { return a + b; }`는 [4.1 함수 템플릿](#/function-templates)에서 본 `template <typename T, typename U> auto add(T a, U b)`와 사실상 같은 것을 만든다 — 다만 이번엔 클로저 클래스의 `operator()`가 통째로 함수 템플릿이 된다.

```cpp title="lambda_generic.cpp — auto 파라미터로 여러 타입을 한 번에 받는다"
#include <iostream>
#include <string>

int main() {
    // auto 파라미터 -- 컴파일러는 operator()를 "함수 템플릿"으로 만든다.
    auto add = [](auto a, auto b) { return a + b; };

    std::cout << "add(1, 2)         = " << add(1, 2) << "\n";              // operator()<int, int> 인스턴스화
    std::cout << "add(1.5, 2.5)     = " << add(1.5, 2.5) << "\n";          // operator()<double, double> 인스턴스화
    std::cout << "add(문자열 결합) = " << add(std::string("foo"), std::string("bar")) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_generic.cpp -o lambda_generic
$ ./lambda_generic
add(1, 2)         = 3
add(1.5, 2.5)     = 4
add(문자열 결합) = foobar
```

(g++ 13.3 실측.) 같은 `add` 객체 하나가 `int`, `double`, `std::string` 세 조합으로 불려서 각각 다른 코드가 실행됐다 — [4.3 템플릿 인스턴스화](#/template-mechanics)의 "호출되는 타입마다 별도 코드를 찍어낸다"가 여기서도 그대로 일어난다. `operator()`가 진짜 함수 템플릿이라는 건 문법으로도 확인된다 — 명시적 템플릿 인자 문법 `.operator()<T, U>(...)`이 통과한다.

```cpp title="lambda_generic_template.cpp — 명시적 템플릿 인자로 operator()를 직접 호출한다"
#include <iostream>

int main() {
    auto add = [](auto a, auto b) { return a + b; };

    // 명시적 템플릿 인자 문법(operator()<int, int>)이 컴파일된다는 것 자체가
    // 이 operator()가 진짜 함수 템플릿이라는 증거다 -- 일반 멤버 함수라면 이 문법은 에러다.
    std::cout << add.operator()<int, int>(3, 4) << "\n";
    std::cout << add.operator()<double, double>(3.5, 4.5) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_generic_template.cpp -o lambda_generic_template
$ ./lambda_generic_template
7
8
```

(g++ 13.3 실측.) 평범한(템플릿이 아닌) 멤버 함수에는 이 문법 자체가 성립하지 않는다 — 컴파일이 됐다는 사실이 `operator()`가 함수 템플릿이라는 증거다. 제네릭 람다는 클로저 클래스에 `template <typename T, typename U> auto operator()(T a, U b) const { ... }`가 그대로 생긴 것과 동일하다.

::: hist 왜 람다는 C++11에 와서야 생겼나
C++11 이전에는 콜백이 필요한 자리마다 이름 있는 함자(functor) 클래스를 따로 선언해야 했다 — `operator()`를 가진 구조체를 호출부와 멀리 떨어진 곳에 정의하고, 캡처할 변수를 생성자 인자로 받는 방식이다. 람다는 이 클래스 선언·생성자·멤버 초기화를 문법 설탕으로 압축한 것뿐이다 — 이 절에서 실측한 결과(클래스라는 것, 캡처가 멤버라는 것)가 정확히 이 사실과 들어맞는 이유다. C++14의 초기화 캡처와 제네릭 람다는 "함자로는 되지만 람다로는 안 되던 것"(이동 캡처, 템플릿 `operator()`)을 마저 메운 확장이다.
:::

## std::function으로 감싸면: 예고

지금까지 본 모든 람다는 캡처가 다르면 `sizeof`도, 타입도 다른 **서로 다른 클래스**였다. 그런데 콜백을 저장하는 컨테이너나 함수 인자는 "캡처가 몇 개든 상관없이 시그니처만 맞으면 받는" 균일한 타입이 필요하다. `std::function<int()>`가 그 역할을 한다 — 서로 다른 클로저 타입을 전부 감춰서 하나의 타입으로 통일하는 **타입 소거**다. 이 통일에는 대가가 따르고, 그 대가의 크기를 여기서 살짝 실측해 둔다.

```cpp title="lambda_function_heap.cpp — std::function이 캡처 크기에 따라 힙을 쓰는지 확인한다"
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <iostream>

// 전역 new를 가로채 힙 할당 횟수를 센다 -- std::function이 실제로 힙을 쓰는지 확인한다.
static int g_alloc_count = 0;

void* operator new(std::size_t size) {
    ++g_alloc_count;
    return std::malloc(size);
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

struct Big3 { double a, b, c; };

int main() {
    int x = 1, y = 2, z = 3;
    auto small_lambda = [x, y, z]() { return x + y + z; };  // 클로저 12바이트

    g_alloc_count = 0;
    std::function<int()> wrapped_small = small_lambda;
    std::cout << "작은 람다(12바이트) 감싸는 동안 new 호출 횟수 = " << g_alloc_count << "\n";

    Big3 big{1, 2, 3};
    auto big_lambda = [big, x, y, z]() { return big.a + x + y + z; };  // 클로저가 더 크다
    std::cout << "sizeof(big_lambda) = " << sizeof(big_lambda) << " bytes\n";

    g_alloc_count = 0;
    std::function<int()> wrapped_big = big_lambda;
    std::cout << "큰 람다 감싸는 동안 new 호출 횟수        = " << g_alloc_count << "\n";

    std::cout << "합계 = " << (wrapped_small() + wrapped_big()) << "\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra lambda_function_heap.cpp -o lambda_function_heap
$ ./lambda_function_heap
작은 람다(12바이트) 감싸는 동안 new 호출 횟수 = 0
sizeof(big_lambda) = 40 bytes
큰 람다 감싸는 동안 new 호출 횟수        = 1
합계 = 13
```

(g++ 13.3 실측.) 12바이트짜리 클로저를 감쌀 땐 `new` 호출이 **0번**이다 — `std::function`이 내부에 작은 버퍼(small buffer optimization)를 두고 그 안에 클로저를 복사해 넣기 때문이다. 40바이트짜리 클로저는 그 버퍼에 안 들어가서 `new`가 **1번** 불렸다. `std::function` 객체 자체의 크기는 캡처 크기와 무관하게 고정(이 환경에서 32바이트)이고, 못 담는 큰 캡처는 힙으로 밀려난다. 이 비용의 정확한 크기와 함수 포인터·템플릿 콜백과의 선택 기준은 [5.7 std::function과 콜러블](#/callables)에서 다룬다.

::: perf 이 절에서 잰 것은 힙 할당 여부까지다
호출 자체의 속도 차이(직접 호출 vs 함수 포인터 vs `std::function`)는 이 절에서 재지 않았다 — 그 비교는 다음 절의 몫이다. 여기서 확정할 수 있는 건 두 가지뿐이다: `std::function`은 고정 크기 객체이고, 그 안에 못 들어가는 캡처는 힙 할당을 유발한다.
:::

## 로보틱스 도메인: rclcpp 콜백 등록과 댕글링 캡처

이 절에서 실측한 댕글링 레퍼런스 캡처는 교과서적인 함정이 아니라 rclcpp 코드에서 실제로 반복되는 버그 패턴이다. `create_subscription`에 등록하는 콜백은 [10.2 토픽: publisher와 subscription](#/pub-sub)에서 보듯 노드 객체보다 훨씬 오래, 다른 스레드의 executor가 부르는 시점에 실행된다. 콜백 람다가 **콜백을 등록하는 함수의 지역 변수**를 참조 캡처하면, 그 함수가 반환된 뒤 executor가 콜백을 부르는 순간 `lambda_dangle.cpp`와 똑같은 stack-use-after-return이 재현된다. 안전한 기본값은 둘이다 — 노드 자신의 상태를 쓴다면 `[this]`로 캡처해 노드의 수명에 기대거나(노드가 구독보다 먼저 파괴되지 않는다는 전제가 성립할 때만), 노드보다 오래 살아야 할 데이터라면 `shared_ptr`를 값으로 캡처해 그 데이터의 수명을 콜백이 직접 붙잡게 만든다.

## 요약

- 람다 표현식은 컴파일러가 그 자리에서 즉석으로 만드는 **이름 없는 클래스(클로저 타입)**의 인스턴스(클로저 객체)다 — `operator()`가 실제 멤버 함수라는 것, 같은 코드의 람다 두 개가 서로 다른 타입이라는 것을 `is_same_v`와 `typeid` 디먼글로 실측했다.
- 캡처는 클로저 클래스의 **멤버 변수**로 저장된다 — `sizeof(람다)`가 캡처한 타입의 크기(값 캡처)나 포인터 크기(레퍼런스 캡처, 원본 크기와 무관하게 항상 고정)만큼 커지는 걸 실측했다.
- 값 캡처(`[x]`, `[=]`)는 캡처 시점의 스냅샷이라 원본이 나중에 바뀌어도 안 바뀐다. 레퍼런스 캡처(`[&x]`, `[&]`)는 원본의 별명이라 원본의 수명이 클로저보다 짧아지면 댕글링이 된다(ASan `stack-use-after-return` 실측).
- `mutable`은 값 캡처 멤버를 `operator()` 안에서 고칠 수 있게 할 뿐, 그 변경을 원본에 반영하지 않는다(실측).
- C++14 초기화 캡처(`[owned = std::move(x)]`)는 복사 생성자가 없는 타입(`unique_ptr` 등)도 이동으로 캡처할 수 있게 한다(실측).
- 제네릭 람다(`auto` 파라미터, C++14)는 클로저의 `operator()`를 진짜 함수 템플릿으로 만든다 — 명시적 템플릿 인자 문법이 컴파일된다는 것으로 실측했다.
- `std::function`은 캡처가 작으면 내부 버퍼에 담아 힙 할당이 없지만, 커지면 힙 할당이 발생한다(실측: `new` 0회 대 1회) — 자세한 비용은 [5.7](#/callables)에서.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 코드를 짜고 컴파일해서 확인하는 실습이다.

1. `auto f = [x, &y]() { ... };`에서 `x`와 `y`는 클로저 클래스의 멤버로 각각 어떤 형태로 저장되는가? `sizeof(f)`가 원본 `x`, `y`의 크기와 어떤 관계인지 설명하라.

2. `mutable`을 붙인 람다가 여러 번 호출되는 동안 값 캡처 멤버의 값이 누적됐다면, 그 값을 초기화하려면(다시 첫 캡처 시점 값으로 되돌리려면) 어떻게 해야 하는가? 원본 변수를 재대입하는 것으로 되는지, 안 된다면 왜 안 되는지 설명하라.

3. (실습, 코드 작성형) 지역 변수를 레퍼런스로 캡처한 람다를 `std::function<int()>`에 담아 반환하는 함수를 직접 타이핑하되, 이번엔 `[&local_value]`가 아니라 **값 캡처** `[local_value]`로 바꿔서 같은 함수를 작성하라. 성공 기준: `g++ -std=c++20 -fsanitize=address -g`로 컴파일·실행했을 때 ASan 리포트가 전혀 뜨지 않고 정상적으로 값을 돌려주는 것을 확인한다.

4. (실습) `lambda_sizeof.cpp`를 그대로 타이핑하고, `Big3`에 `double` 멤버를 하나 더 추가해 32바이트로 만든 뒤 값 캡처와 레퍼런스 캡처의 `sizeof`가 각각 어떻게 바뀌는지 확인하라. 성공 기준: 값 캡처는 32바이트로 늘고, 레퍼런스 캡처는 여전히 8바이트에 머무는 것을 눈으로 확인한다.

5. (실습) `lambda_mutable_error.cpp`의 컴파일 에러를 직접 재현한 뒤, `mutable`을 붙여서 통과시키고, `with_mutable()`을 5번 호출한 결과와 원본 변수의 최종 값을 각각 출력해 봐라. 성공 기준: 호출마다 누적된 값과, 끝까지 안 바뀐 원본 값을 둘 다 콘솔에서 확인했다.
:::

::: answer 해설
1. `x`는 값 캡처라 클로저 안에 `int` 크기(4바이트)의 복사본으로 저장된다. `y`는 레퍼런스 캡처라 참조(포인터, x86-64에서 8바이트)로 저장된다. `sizeof(f)`는 `y`의 원본 크기와 무관하게 `sizeof(x의 타입) + 8`에 정렬 패딩을 더한 값이 된다 — 원본이 아무리 커도 레퍼런스 캡처 쪽은 항상 포인터 하나 크기다.
2. 원본 변수를 재대입해도 소용없다. `mutable` 값 캡처는 생성 시점에 복사해 온 별도의 멤버라서, 그 이후 원본을 바꿔도 이미 존재하는 클로저 객체는 그 변화를 알 방법이 없다. 초기화하려면 새 람다 표현식을 다시 평가해 새 클로저 객체를 얻는 수밖에 없다.
3. 값 캡처로 바꾸면 함수가 끝나기 전에 `local_value`가 이미 클로저 멤버로 복사돼 있으므로, 원본 스택 프레임이 사라져도 클로저는 자신의 복사본만 참조한다 — 연결이 끊겨 있어 use-after-return이 발생하지 않는다.
4. `Big3`가 32바이트가 되면 값 캡처 `[big]`의 `sizeof`도 32바이트로 따라 늘어난다. 레퍼런스 캡처 `[&big]`는 원본 크기와 무관하게 여전히 8바이트다 — "가리키는 참조"의 크기는 원본 크기와 무관하기 때문이다.
5. `mutable`을 붙이면 컴파일이 통과하고, 5번 부르면 `1, 2, 3, 4, 5`가 누적돼 찍힌다. 원본 변수는 `lambda_mutable.cpp` 실측과 동일하게 끝까지 `0`으로 남는다.
:::

::: interview "람다의 캡처 방식([=] vs [&])과 그 위험을 설명하라"
클로저·캡처 관련 면접에서 가장 흔한 질문이다. 답변 뼈대: ① 람다는 컴파일러가 만드는 이름 없는 클래스(클로저 타입)의 인스턴스이고, 캡처는 그 클래스의 멤버 변수다(`sizeof` 실측). ② `[=]`(값 캡처)는 캡처 시점 값을 멤버로 복사하므로 원본이 나중에 바뀌어도 영향받지 않는다. `[&]`(레퍼런스 캡처)는 원본을 가리키는 참조를 저장하므로 변화를 그대로 반영하지만, 원본의 수명이 클로저보다 짧으면 댕글링이 된다. ③ 위험한 패턴은 "람다를 저장해 뒀다가 원래 스코프 밖에서 호출하는 경우"다 — 지역 변수를 참조 캡처해 반환하면 함수가 끝나는 순간 참조 대상이 사라진다(이 절의 ASan `stack-use-after-return` 실측이 증거). ④ 실무 기준: 람다가 그 자리에서 즉시 소비되면(`std::sort` 비교자 등) 레퍼런스 캡처가 저렴하고 안전하지만, 저장돼 나중에 불릴 가능성이 있으면 값 캡처를 기본으로 하고 필요하면 `shared_ptr`로 수명을 스스로 관리시킨다.
:::

이 절의 `lambda_is_class.cpp`, `lambda_demangle.cpp`, `lambda_sizeof.cpp`, `lambda_snapshot.cpp`, `lambda_mutable_error.cpp`, `lambda_mutable.cpp`, `lambda_init_capture_error.cpp`, `lambda_init_capture.cpp`, `lambda_generic.cpp`, `lambda_generic_template.cpp`, `lambda_function_heap.cpp`를 전부 직접 타이핑해라. `lambda_dangle.cpp`는 `-fsanitize=address -g`를 붙여서 돌려 `stack-use-after-return` 리포트를 두 눈으로 확인해라. 기준 명령: `g++ -std=c++20 -Wall -Wextra 파일.cpp -o 이름 && ./이름`.

**다음 절**: [5.7 std::function과 콜러블](#/callables) — 이 절에서 본 "캡처마다 서로 다른 타입"이라는 문제를 정면으로 다룬다. `std::function`의 타입 소거가 정확히 무슨 비용을 치르는지, 함수 포인터·템플릿 콜백·`std::function` 중 언제 무엇을 골라야 하는지를 실측으로 정리한다.

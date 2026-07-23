# 3.2 생성자와 소멸자의 모든 것

::: lead
[3.1 클래스: 캡슐화와 불변식](#/classes)에서 멤버 초기화 리스트로 불변식을 강제하는 법을 배웠다. 그런데 같은 클래스에 인자 개수가 다른 생성자를 여러 개 두면, 그 불변식을 지키는 검증 로직을 생성자 개수만큼 복사해 붙여야 한다는 문제가 남는다 — 하나라도 빠뜨리면 그 생성자로 만든 객체만 조용히 규칙을 벗어난다. 이 절은 그 중복을 위임 생성자로 없애는 법에서 시작해, 생성·소멸이 정확히 어떤 순서로 일어나는지, 단일 인자 생성자가 여는 뜻밖의 암묵 변환 통로를 `explicit`으로 막는 법, 그리고 소멸자·생성자 안에서 하면 안 되는 일 두 가지(예외를 던지는 것, 가상 함수를 부르는 것)를 실측으로 확인한다.
:::

## 검증 로직을 생성자 개수만큼 복사해 붙인 사고

헥사포드 다리 하나를 제어하는 `LegController`를 만든다고 하자. 다리 id만 받는 버전, id와 오프셋 각도를 받는 버전, 셋 다 받는 버전 — 호출하는 쪽 편의를 위해 오버로드를 세 개 뒀다. 다리 id는 0~5번뿐이므로 세 생성자 모두 그 범위를 검증해야 한다.

```cpp title="no_delegation_duplication.cpp — 위임 생성자 없이 짠 중복 초기화"
#include <iostream>
#include <stdexcept>

class LegController {
public:
    LegController(int id) : id_(id), offset_deg_(0), max_speed_(180) {
        if (id_ < 0 || id_ > 5) throw std::invalid_argument("id out of range");
        std::cout << "[생성] id=" << id_ << " offset=" << offset_deg_ << " max_speed=" << max_speed_ << "\n";
    }
    LegController(int id, int offset_deg) : id_(id), offset_deg_(offset_deg), max_speed_(180) {
        if (id_ < 0 || id_ > 5) throw std::invalid_argument("id out of range");
        std::cout << "[생성] id=" << id_ << " offset=" << offset_deg_ << " max_speed=" << max_speed_ << "\n";
    }
    LegController(int id, int offset_deg, int max_speed)
        : id_(id), offset_deg_(offset_deg), max_speed_(max_speed) {
        // 검증 로직을 여기 또 옮겨 적어야 하는데 깜빡했다 -- id_ 범위 체크가 없다
        std::cout << "[생성] id=" << id_ << " offset=" << offset_deg_ << " max_speed=" << max_speed_ << "\n";
    }

    int id_, offset_deg_, max_speed_;
};

int main() {
    LegController a(2);
    LegController b(2, 15);
    LegController c(99, 0, 200);   // 세 번째 생성자는 검증을 거치지 않는다
    std::cout << "c.id_ = " << c.id_ << "  (다리는 0~5번뿐인데 범위 검사를 통과했다)\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra no_delegation_duplication.cpp -o no_delegation_duplication
$ ./no_delegation_duplication
[생성] id=2 offset=0 max_speed=180
[생성] id=2 offset=15 max_speed=180
[생성] id=99 offset=0 max_speed=200
c.id_ = 99  (다리는 0~5번뿐인데 범위 검사를 통과했다)
```

(g++ 13.3 실측, 경고 없이 컴파일된다.) `c`는 존재하지 않는 99번 다리로 만들어졌는데 프로그램은 아무 불평 없이 넘어간다. 세 번째 생성자를 짤 때 앞 두 개의 검증 코드를 복사해 붙이는 걸 깜빡했을 뿐이다 — 컴파일러는 이 실수를 잡아줄 방법이 없다. 세 생성자가 하는 일은 사실 하나다: 세 값을 받아 검증하고 멤버에 채운다. 나머지 두 생성자는 그 중 일부를 기본값으로 채워 부르는 것뿐인데, 코드는 세 벌을 따로 유지하고 있다.

::: danger 중복된 검증은 하나만 고치고 잊는 버그를 만든다
생성자가 여러 개일 때 공통 로직을 각자 다시 적으면, 나중에 검증 규칙이 바뀌었을 때(예: 다리가 8개로 늘어난다) 세 곳을 전부 찾아 고쳐야 한다. 하나라도 놓치면 그 생성자로 만든 객체만 조용히 다른 불변식을 갖게 된다 — 지금 본 `c`가 정확히 그 사고다.
:::

## 생성 순서의 전체 그림: 베이스 → 멤버(선언 순) → 본문

이 사고를 고치기 전에, 객체 하나가 만들어질 때 정확히 어떤 순서로 코드가 실행되는지부터 못박아야 한다. 순서는 세 단계로 고정돼 있고, **어떤 순서로도 바꿀 수 없다.**

1. 베이스 클래스 서브오브젝트 (있다면, [3.3 상속: is-a의 비용](#/inheritance)에서 다시 다룬다)
2. 멤버 변수 — **클래스에 선언된 순서대로.** 초기화 리스트에 적은 순서는 무관하다
3. 생성자 본문

소멸은 정확히 반대 순서다: 본문 실행 → 멤버 역순 소멸 → 베이스 소멸. 이 규칙에서 가장 자주 오해하는 지점이 2번이다 — 초기화 리스트의 순서가 실행 순서를 결정한다고 믿기 쉬운데, 실제로 실행 순서를 결정하는 건 **멤버가 클래스 안에 선언된 줄 순서**뿐이다. 일부러 어긋나게 짜서 확인한다.

```cpp title="construction_order.cpp — 생성은 베이스→멤버(선언 순)→본문, 소멸은 정반대"
#include <iostream>

struct Base {
    Base() { std::cout << "[Base 생성자]\n"; }
    ~Base() { std::cout << "[Base 소멸자]\n"; }
};

struct Sensor {
    explicit Sensor(const char* name) : name_(name) {
        std::cout << "[Sensor 생성] " << name_ << "\n";
    }
    ~Sensor() { std::cout << "[Sensor 소멸] " << name_ << "\n"; }
    const char* name_;
};

class LegController : public Base {
public:
    // 초기화 리스트는 encoder_, motor_ 순서로 적었다 -- 그러나 실행 순서는 선언 순서를 따른다
    LegController() : encoder_("encoder"), motor_("motor") {
        std::cout << "[LegController 생성자 본문]\n";
    }
    ~LegController() { std::cout << "[LegController 소멸자 본문]\n"; }

private:
    Sensor motor_;     // 선언 순서 1번째
    Sensor encoder_;   // 선언 순서 2번째
};

int main() {
    std::cout << "--- 생성 ---\n";
    LegController leg;
    std::cout << "--- 소멸 ---\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra construction_order.cpp -o construction_order
construction_order.cpp: In constructor 'LegController::LegController()':
construction_order.cpp:26:12: warning: 'LegController::encoder_' will be initialized after [-Wreorder]
   26 |     Sensor encoder_;   // 선언 순서 2번째
      |            ^~~~~~~~
construction_order.cpp:25:12: warning:   'Sensor LegController::motor_' [-Wreorder]
   25 |     Sensor motor_;     // 선언 순서 1번째
      |            ^~~~~~
construction_order.cpp:19:5: warning:   when initialized here [-Wreorder]
   19 |     LegController() : encoder_("encoder"), motor_("motor") {
      |     ^~~~~~~~~~~~~

$ ./construction_order
--- 생성 ---
[Base 생성자]
[Sensor 생성] motor
[Sensor 생성] encoder
[LegController 생성자 본문]
--- 소멸 ---
[LegController 소멸자 본문]
[Sensor 소멸] encoder
[Sensor 소멸] motor
[Base 소멸자]
```

(g++ 13.3 실측.) 초기화 리스트는 `encoder_`를 먼저 적었는데, 실제로 먼저 생성된 건 `motor_`다 — 클래스 안에 `motor_`가 먼저 선언돼 있기 때문이다. 컴파일러는 이 불일치를 `-Wreorder` 경고로 미리 알려준다: "네가 적은 순서와 실제 실행 순서가 다르다"는 뜻이다. 소멸은 정확히 거울상이다 — `LegController` 본문이 먼저 실행되고, 멤버는 선언의 **역순**(`encoder_` → `motor_`)으로 소멸하고, 마지막에 `Base`가 소멸한다. 이 순서가 바뀔 수 없는 이유는 간단하다 — 베이스가 먼저 완성돼야 그 위에 얹히는 파생 부분과 멤버가 안전하게 그 베이스를 참조할 수 있고, 소멸은 그 의존관계를 반대로 풀어야 하기 때문이다.

::: tip 초기화 리스트는 선언 순서 그대로 적어라
`-Wreorder` 경고는 버그가 아니라 코드 냄새를 미리 알려주는 것이다. 초기화 리스트의 순서를 항상 멤버 선언 순서와 맞춰 쓰면, "실행 순서가 리스트 순서와 다르다"는 혼동 자체가 애초에 생기지 않는다. `-Wall`을 켜고 이 경고가 뜨면 리스트가 아니라 선언 순서를 기준으로 리스트를 고쳐라.
:::

## 위임 생성자: 검증 로직을 한 곳에 모은다

이제 이 절 서두의 중복 사고로 돌아간다. C++11부터는 생성자의 초기화 리스트에 멤버 대신 **자기 자신의 다른 생성자**를 적을 수 있다 — 이를 위임 생성자(delegating constructor)라 부른다. 위임하는 생성자는 멤버를 직접 초기화하는 대신 그 초기화를 통째로 다른 생성자에 넘긴다.

```cpp title="delegating_ctor.cpp — 위임 생성자로 검증 로직을 한 곳에 모은다"
#include <iostream>
#include <stdexcept>

class LegController {
public:
    LegController(int id) : LegController(id, 0, 180) {}
    LegController(int id, int offset_deg) : LegController(id, offset_deg, 180) {}
    LegController(int id, int offset_deg, int max_speed)
        : id_(id), offset_deg_(offset_deg), max_speed_(max_speed) {
        if (id_ < 0 || id_ > 5) throw std::invalid_argument("id out of range");
        std::cout << "[생성] id=" << id_ << " offset=" << offset_deg_ << " max_speed=" << max_speed_ << "\n";
    }

    int id_, offset_deg_, max_speed_;
};

int main() {
    LegController a(2);
    LegController b(2, 15);
    try {
        LegController c(99, 0, 200);   // 어느 생성자로 들어와도 결국 이 검증을 거친다
    } catch (const std::exception& e) {
        std::cout << "[catch] " << e.what() << "\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra delegating_ctor.cpp -o delegating_ctor
$ ./delegating_ctor
[생성] id=2 offset=0 max_speed=180
[생성] id=2 offset=15 max_speed=180
[catch] id out of range
```

(g++ 13.3 실측.) 인자 하나짜리 생성자와 인자 둘짜리 생성자는 이제 검증 코드를 단 한 줄도 갖고 있지 않다 — 그냥 셋짜리 생성자를 기본값과 함께 부를 뿐이다. `c(99, 0, 200)`은 셋짜리 생성자로 직접 들어가고, 앞의 두 생성자로 들어온 호출도 결국 같은 셋짜리 생성자를 거치므로 **검증 로직을 놓칠 방법 자체가 없어졌다.** 앞 절에서 `c.id_ = 99`가 조용히 통과했던 것과 달리 이번엔 어느 경로로 와도 `std::invalid_argument`가 던져진다.

::: deep 위임은 함수 호출이 아니라 생성 순서의 일부다
`LegController(int id) : LegController(id, 0, 180) {}`는 셋짜리 생성자를 "부르고 돌아오는" 게 아니다 — 셋짜리 생성자가 **완전히 끝나야**(멤버 초기화와 본문까지 전부) 한짜리 생성자의 본문이 이어서 실행된다. 위임받은 생성자가 예외를 던지면(방금 본 `c`의 경우) 위임한 생성자의 본문은 아예 실행되지 않는다. 그리고 문법상 제약이 하나 있다 — 위임하는 생성자의 초기화 리스트에는 다른 생성자 호출 **하나만** 올 수 있다. 멤버를 직접 초기화하면서 동시에 다른 생성자에 위임할 수는 없다 — 위임하거나, 직접 멤버를 초기화하거나 둘 중 하나다.
:::

## explicit: 단일 인자 생성자가 여는 암묵 변환 통로

로봇 도메인에서는 단위가 있는 값을 원시 숫자 그대로 넘기다 실수하는 일이 흔하다 — 각도(degree)를 받아야 할 자리에 길이(meter) 값을 넘기거나 그 반대인 경우다. 단위 하나를 감싸는 얇은 타입 `Meters`를 만들어 이 실수를 막으려 한다고 하자.

```cpp title="implicit_conversion_trap.cpp — 단일 인자 생성자가 암묵 변환 통로가 된다"
#include <iostream>

class Meters {
public:
    Meters(double value) : value_(value) {}   // explicit 없음 -- 암묵 변환 통로가 열린다
    double value_;
};

void move_leg(Meters distance) {
    std::cout << "다리를 " << distance.value_ << "m 이동\n";
}

int main() {
    move_leg(3.5);    // 의도한 호출
    move_leg(180);    // 실수로 각도(180도)를 넘겼는데 컴파일러가 조용히 Meters로 바꿔 통과시킨다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra implicit_conversion_trap.cpp -o implicit_conversion_trap
$ ./implicit_conversion_trap
다리를 3.5m 이동
다리를 180m 이동
```

(g++ 13.3 실측, `-Wall -Wextra`에서도 경고가 없다.) `move_leg(180)`은 `Meters`를 받는 함수에 `int`를 그냥 넘긴 코드다. 컴파일러는 `Meters(double)` 생성자가 인자 하나를 받는다는 것을 보고 `180`을 `Meters(180)`으로 조용히 변환해 호출을 성립시킨다 — **경고 한 줄 없이.** 이게 정확히 함정이다. 호출자는 "180도"를 의도했을 수도 있는데, 타입 시스템은 그걸 구분할 방법이 없다. 인자를 하나만 받는 생성자는 컴파일러 눈에 "이 타입으로 가는 암묵 변환 규칙"으로 보인다 — 명시적으로 막지 않는 한 기본값이 "허용"이다.

`explicit` 키워드를 생성자 앞에 붙이면 이 통로를 차단한다.

```cpp title="explicit_blocks_conversion.cpp — explicit을 붙이면 같은 실수가 컴파일 에러가 된다"
#include <iostream>

class Meters {
public:
    explicit Meters(double value) : value_(value) {}   // explicit -- 암묵 변환을 막는다
    double value_;
};

void move_leg(Meters distance) {
    std::cout << "다리를 " << distance.value_ << "m 이동\n";
}

int main() {
    move_leg(Meters(3.5));   // 명시적 생성 -- 통과
    move_leg(180);            // 암묵 변환 시도 -- 이제 컴파일 에러
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra explicit_blocks_conversion.cpp -o explicit_blocks_conversion
explicit_blocks_conversion.cpp: In function 'int main()':
explicit_blocks_conversion.cpp:15:14: error: could not convert '180' from 'int' to 'Meters'
   15 |     move_leg(180);            // 암묵 변환 시도 -- 이제 컴파일 에러
      |              ^~~
      |              |
      |              int
```

(g++ 13.3 실측.) 코드는 딱 한 단어(`explicit`) 차이인데 결과는 "조용히 틀린 값으로 실행됨"에서 "컴파일이 아예 안 됨"으로 바뀐다. 호출하는 쪽은 이제 `move_leg(Meters(180))`처럼 자기가 무슨 단위를 넘기는지 소스에 눈으로 보이게 적어야만 코드가 통과한다.

::: danger 로봇 도메인에서 explicit은 선택이 아니다
`Meters`, `Radians`, `Degrees`, `Newtons` 같은 단위 래퍼 타입은 인자 하나짜리 생성자로 만드는 게 자연스러운데, 그 인자 하나짜리 구조 자체가 위 함정을 그대로 만든다. `explicit` 없이 단위 타입을 여러 개 두면 "각도 인자에 길이 값을 실수로 넘기는" 종류의 버그가 컴파일러 도움 없이 런타임까지 살아남는다 — 그것도 시뮬레이션에서는 안 잡히고 실제 하드웨어에 잘못된 크기의 명령이 나간 뒤에야 드러나는 부류다. **단일 인자 생성자를 쓰는 값 타입은 암묵 변환을 원하는 극히 드문 경우(예: 표준 라이브러리의 `std::string(const char*)`처럼 변환 자체가 그 타입의 존재 이유인 경우)를 빼고는 예외 없이 `explicit`을 붙인다.**
:::

## 소멸자는 예외를 던지면 안 된다

생성자는 실패하면 예외를 던지는 게 정상적인 관용구다(뒤에서 확인한다). 소멸자는 정반대다 — **소멸자는 예외를 던지면 안 된다.** 이유는 스택 되감기의 구조에 있다. 예외 하나가 스택을 되감는 도중에 지역 객체의 소멸자가 호출되는데, 그 소멸자마저 예외를 던지면 런타임은 동시에 두 개의 예외를 처리해야 하는 상황에 빠진다 — 표준은 이걸 감당하지 않고 그 자리에서 `std::terminate`를 부른다.

```cpp title="destructor_throws_terminate.cpp — 되감기 중 소멸자가 예외를 던지면 terminate"
#include <iostream>
#include <stdexcept>

struct Bad {
    ~Bad() noexcept(false) {   // 기본값(noexcept)을 강제로 뒤집었다 -- 정상적으로는 이러면 안 된다
        std::cout << "[Bad 소멸자] 예외를 던진다\n";
        throw std::runtime_error("소멸자에서 던진 예외");
    }
};

void trigger() {
    Bad b;
    throw std::runtime_error("첫 번째 예외");   // 되감기 시작 -> b 소멸 -> 소멸자가 또 예외
}

int main() {
    try {
        trigger();
    } catch (...) {
        std::cout << "여기 도달 못한다\n";
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra destructor_throws_terminate.cpp -o destructor_throws_terminate
$ ./destructor_throws_terminate
terminate called after throwing an instance of 'std::runtime_error'
  what():  소멸자에서 던진 예외
Aborted (core dumped)
```

(g++ 13.3 / Linux x86-64 실측. 이 환경에서는 `Aborted`로 죽었지만, `std::terminate` 호출 자체가 표준이 보장하는 결과이지 이 종료 메시지 형태까지 보장되는 건 아니다.) `main`의 `catch (...)`는 존재하지도 못했다 — `첫 번째 예외`가 되감기를 시작해 `Bad::~Bad()`를 부르는데, 그 소멸자가 또 던진 순간 프로그램은 그 즉시 `std::terminate`로 넘어가 죽는다. 이 예제는 `noexcept(false)`로 억지로 소멸자의 기본 동작을 뒤집어야만 컴파일된다 — 그만큼 "소멸자가 예외를 던진다"는 것 자체가 정상 경로가 아니라는 뜻이다.

```console
$ g++ -std=c++20 -Wall -Wextra dtor_noexcept_default.cpp -o dtor_noexcept_default
$ ./dtor_noexcept_default
noexcept(Plain::~Plain()) = true
noexcept(ForcedThrow::~ForcedThrow()) = false
```

(g++ 13.3 실측, `noexcept(...)` 연산자로 확인.) 아무 명시도 하지 않은 평범한 소멸자 `Plain::~Plain()`은 `noexcept(true)`로 확인된다 — **소멸자는 사용자가 아무것도 안 적어도 암묵적으로 `noexcept`다.** 위의 `Bad`처럼 `noexcept(false)`를 강제로 붙여야만 그 보장을 깰 수 있고, 표준 라이브러리 전체가 이 전제 위에서 동작한다(예: `std::vector`가 원소를 옮길 때 소멸자가 예외를 던지지 않는다고 가정한다).

::: danger 자원 해제 실패는 예외가 아니라 별도 함수로 알려라
`fclose`가 실패하거나 소켓을 닫는 시스템 콜이 에러를 반환해도 소멸자 안에서는 그 실패를 예외로 알리지 마라. [2.5 RAII](#/raii)의 `FileGuard`가 소멸자에서 `fclose`의 반환값을 조용히 버린 이유가 이것이다 — 해제 실패를 반드시 알려야 한다면 `close()`라는 별도의 멤버 함수를 만들어 호출자가 명시적으로 부르게 하고, 소멸자는 그 함수가 안 불렸을 때를 대비한 마지막 안전망으로만 둔다.
:::

## 가상 소멸자를 미리 예고한다

지금까지 본 소멸자는 전부 non-virtual이었다. 베이스 클래스 포인터로 파생 클래스 객체를 가리키다가 `delete`할 일이 있는 클래스 계층에서는 소멸자를 `virtual`로 선언하지 않으면 파생 클래스의 소멸자가 호출되지 않고 베이스 클래스 몫의 자원만 정리된 채 나머지가 새는 사고가 난다 — 다형적으로 삭제해도 안전하려면 소멸자가 가상이어야 한다는 뜻이다. 이 메커니즘의 이유(vtable이 정확히 무엇이고 왜 이 순서로 함수를 찾는지)는 [3.4 가상함수와 vtable](#/virtual-vtable)에서 다형 삭제 문제를 실측으로 재현하며 정식으로 다룬다.

## 생성자 안에서 가상 함수를 부르면 안 되는 이유

`virtual` 함수는 "실제 객체의 동적 타입에 맞는 함수가 불린다"는 게 요지인데, 생성자 안에서는 이 규칙이 예외를 만든다. 베이스 클래스의 생성자가 실행되는 시점에는 **파생 클래스 부분이 아직 존재하지 않는다** — 베이스가 완성돼야 그 위에 파생이 얹히므로, 베이스 생성자 본문이 도는 동안 객체는 정말로 "아직 베이스일 뿐"이다. 그래서 그 안에서 가상 함수를 부르면 파생 버전이 아니라 베이스 버전이 불린다.

```cpp title="virtual_call_in_constructor.cpp — 생성자 안에서 가상 함수는 파생 버전으로 가지 않는다"
#include <iostream>

class Base {
public:
    Base() {
        std::cout << "[Base 생성자] init() 호출 -> ";
        init();   // 가상 함수를 생성자에서 호출한다
    }
    virtual void init() { std::cout << "Base::init 실행\n"; }
    virtual ~Base() = default;
};

class Derived : public Base {
public:
    void init() override { std::cout << "Derived::init 실행\n"; }
};

int main() {
    std::cout << "--- Derived d; ---\n";
    Derived d;
    std::cout << "--- d.init() 직접 호출 ---\n";
    d.init();
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra virtual_call_in_constructor.cpp -o virtual_call_in_constructor
$ ./virtual_call_in_constructor
--- Derived d; ---
[Base 생성자] init() 호출 -> Base::init 실행
--- d.init() 직접 호출 ---
Derived::init 실행
```

(g++ 13.3 실측.) `Derived`를 만들었는데도 `Base` 생성자 안에서 부른 `init()`은 `Base::init`이다. 반면 객체가 완전히 만들어진 뒤 `d.init()`을 직접 부르면 정상적으로 `Derived::init`이 실행된다 — 같은 `init()` 호출인데 시점에 따라 다른 함수가 불린 것이다. 지금은 이 현상을 실측으로만 확인한다. "왜 이 시점에는 아직 파생 버전을 가리키지 못하는가"는 vtable 포인터가 생성 도중 단계적으로 채워진다는 사실에 달려 있고, 그 구조는 [3.4 가상함수와 vtable](#/virtual-vtable)에서 그림으로 정식으로 다룬다.

::: warn 생성자·소멸자에서 가상 함수를 부르는 코드는 짜지 마라
컴파일도 되고 경고도 없이 조용히 "의도와 다른 함수"가 불린다는 점에서 이 함정은 `explicit` 누락보다 발견하기 어렵다. 초기화 로직이 파생 클래스마다 달라야 한다면 가상 함수로 생성자에서 분기하려 하지 말고, 객체를 다 만든 뒤 별도의 `init()` 멤버 함수를 명시적으로 호출하는 2단계 초기화(two-phase initialization) 패턴을 써라.
:::

## 로봇 도메인: 하드웨어 초기화 실패는 생성자의 예외로 알린다

생성자의 관용구는 "성공하거나, 예외를 던지거나" 둘 중 하나다 — 절반만 완성된 상태로 조용히 반환하는 제3의 길은 없다. 모터 드라이버처럼 실제 장치와 연결하는 생성자는 이 관용구를 그대로 따른다: 연결에 실패하면 그 자리에서 예외를 던져 "이 객체는 존재하지 않는다"는 것을 호출자에게 강제로 알린다.

```cpp title="hardware_init_exception.cpp — 생성자에서 예외로 초기화 실패를 알린다"
#include <iostream>
#include <memory>
#include <stdexcept>

class MotorDriver {
public:
    explicit MotorDriver(int fake_fd) : fd_(fake_fd) {
        if (fd_ < 0) throw std::runtime_error("모터 드라이버 연결 실패");
        std::cout << "[MotorDriver 생성] fd=" << fd_ << "\n";
    }
    ~MotorDriver() {
        if (fd_ >= 0) std::cout << "[MotorDriver 소멸] fd=" << fd_ << " 정리\n";
    }
    int fd_;
};

int main() {
    try {
        auto hip = std::make_unique<MotorDriver>(3);     // 정상 연결
        auto knee = std::make_unique<MotorDriver>(-1);    // 연결 실패 -- 생성자에서 즉시 예외
        std::cout << "여기 도달 못한다\n";
    } catch (const std::exception& e) {
        std::cout << "[catch] " << e.what() << "\n";
    }
    std::cout << "main 계속 진행\n";
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address hardware_init_exception.cpp -o hardware_init_exception
$ ./hardware_init_exception
[MotorDriver 생성] fd=3
[MotorDriver 소멸] fd=3 정리
[catch] 모터 드라이버 연결 실패
main 계속 진행
```

(g++ 13.3 / `-fsanitize=address` 실측, 리크 리포트 없음.) `hip`은 완전히 만들어졌다가 `knee`의 생성자가 던진 예외 때문에 스택이 되감기며 정리된다 — `[MotorDriver 소멸] fd=3`이 그 증거다. `knee` 자신은 생성자 본문 중간에서 예외가 났으므로 **객체 자체가 완성되지 않았고, 그래서 소멸자도 불리지 않는다**(완성되지 않은 객체는 소멸시킬 대상이 없다). `unique_ptr`([2.9 unique_ptr](#/unique-ptr))로 감싼 덕분에, 다리가 여섯 개로 늘어나 생성자가 열 번 불려도 몇 번째에서 실패하든 그 이전까지 성공한 모든 핸들이 자동으로 정리된다 — 실패 지점마다 수동으로 정리 코드를 짤 필요가 없다. [10.9 ros2_control과 hardware_interface](#/ros2-control)의 실제 하드웨어 인터페이스도 이 패턴이다: `on_init`/생성자 단계에서 장치 연결에 실패하면 예외(또는 실패를 나타내는 반환값)로 그 사실을 즉시 알리고, 이미 열린 다른 핸들은 RAII([2.5](#/raii))가 각자의 소멸자로 되돌린다.

::: interview 생성자에서 가상 함수를 호출하면 안 되는 이유
답변 뼈대: ① **현상** — 베이스 클래스 생성자 안에서 가상 함수를 부르면 파생 클래스가 오버라이드한 버전이 아니라 베이스 클래스 버전이 불린다(`virtual_call_in_constructor.cpp`가 실측으로 보여준다). ② **이유** — 베이스 생성자가 실행되는 시점에는 파생 클래스 부분이 아직 만들어지지 않았다. 객체는 베이스 → 멤버 → 파생 순서로 단계적으로 완성되는데, 베이스 단계에서는 그 객체의 동적 타입이 사실상 베이스 그 자체다. ③ **대책** — 파생 클래스마다 다른 초기화가 필요하면 생성자 안에서 가상 함수로 분기하지 말고, 객체를 완전히 만든 뒤 별도의 `init()` 함수를 명시적으로 호출하는 2단계 초기화를 쓴다. ④ 심화 질문 "소멸자에서는?" — 마찬가지다, 파생 클래스의 소멸자가 먼저 실행되고 베이스 소멸자가 나중에 실행되므로 베이스 소멸자 안에서는 이미 파생 부분이 소멸된 뒤라 똑같이 베이스 버전이 불린다.
:::

## 요약

- 여러 생성자가 같은 검증·초기화 로직을 각자 반복하면 하나를 고칠 때 나머지를 놓치는 버그가 생긴다(`no_delegation_duplication.cpp`가 실측으로 보여준 사고).
- 생성 순서는 **베이스 → 멤버(선언 순) → 본문**으로 고정돼 있다. 초기화 리스트의 순서가 아니라 클래스 안 선언 순서가 실행 순서를 결정하고, 어긋나면 `-Wreorder`가 경고한다. 소멸은 정확히 반대 순서다.
- **위임 생성자**로 공통 로직을 대표 생성자 하나에 모으면, 어느 생성자로 들어와도 같은 검증을 반드시 거치게 만들 수 있다(`delegating_ctor.cpp`).
- 인자 하나짜리 생성자는 기본적으로 암묵 변환 통로다 — `explicit`을 붙이지 않으면 컴파일러가 경고 없이 조용히 타입을 바꿔치기한다(`implicit_conversion_trap.cpp`). 단위를 감싸는 로봇 도메인 타입(`Meters`, `Radians` 등)은 예외 없이 `explicit`을 붙인다.
- **소멸자는 예외를 던지면 안 된다** — 다른 예외로 스택이 되감기는 도중 소멸자가 또 던지면 `std::terminate`가 즉시 호출된다(`destructor_throws_terminate.cpp`). 소멸자는 사용자가 아무것도 안 적어도 암묵적으로 `noexcept`다.
- 다형적으로 삭제되는 클래스 계층은 소멸자가 `virtual`이어야 한다 — 이유와 구조는 [3.4](#/virtual-vtable)에서 다룬다.
- **생성자 안에서 가상 함수를 부르면 파생 버전이 아니라 베이스 버전이 불린다** — 파생 부분이 아직 존재하지 않기 때문이다(`virtual_call_in_constructor.cpp`).
- 생성자는 성공하거나 예외를 던지거나 둘 중 하나다. `unique_ptr` 같은 RAII와 결합하면 하드웨어 초기화 도중 일부만 실패해도 이미 성공한 나머지는 자동으로 정리된다(`hardware_init_exception.cpp`, ASan 리크 없음 확인).

::: quiz 연습문제
1~3번은 개념·예측 문제, 4~5번은 네 컴퓨터에서 직접 확인하는 실습(코드 작성형)이다.

1. `construction_order.cpp`에서 `LegController`에 세 번째 멤버 `Sensor imu_;`를 `motor_` 다음, `encoder_` 앞에 선언으로 추가하고 초기화 리스트에도 넣는다면(리스트 순서는 신경 쓰지 않고 아무 데나 넣는다), 생성 시 `motor_`·`imu_`·`encoder_`의 로그가 어떤 순서로 찍힐지 예측하고 그 근거를 설명하라.
2. `virtual_call_in_constructor.cpp`에서 `Derived`가 자기만의 멤버 변수를 갖고 있고 그 멤버가 `init()` 안에서 쓰인다면, `Base` 생성자에서 `init()`을 부르는 게 왜 타입 오류를 넘어선 실질적인 위험(초기화 안 된 멤버 접근)까지 만드는지 설명하라.
3. `hardware_init_exception.cpp`에서 `hip`과 `knee`의 순서를 바꿔 `knee`(실패하는 쪽)를 먼저 만들면 `hip`(성공하는 쪽)의 생성·소멸 로그가 어떻게 될지 예측하라.
4. (실습, 코드 작성형) 인자 개수가 다른 생성자 세 개를 가진 클래스(예: 카메라 노출 설정 — id만, id+해상도, id+해상도+프레임레이트)를 검증 로직 없이 중복되게 먼저 짜라. 그다음 위임 생성자로 리팩터링해 검증 로직을 한 곳에만 남기고, 잘못된 값(음수 프레임레이트 등)을 아무 생성자로 넣어도 예외가 던져지는 것을 확인하라. 성공 기준: `g++ -std=c++20 -Wall -Wextra main.cpp -o main`으로 경고 없이 컴파일되고, 세 생성자 전부에서 검증이 걸린다.
5. (실습, 코드 작성형) `Radians`라는 단위 타입을 `explicit` 없이 만들고, `void set_joint_angle(Radians r)` 같은 함수에 정수 리터럴을 그대로 넘기는 코드가 경고 없이 컴파일되는 것을 확인하라. 그 다음 `explicit`을 붙이고 같은 호출이 컴파일 에러로 바뀌는 것을 확인하라. 성공 기준: 첫 번째 버전은 `g++ -std=c++20 -Wall -Wextra`에서 경고가 없고, 두 번째 버전은 정확히 "could not convert" 계열 에러로 실패한다.
:::

::: answer 해설
1. 선언 순서가 `motor_`, `imu_`, `encoder_`이므로 초기화 리스트에 어떤 순서로 적든 로그는 `motor` → `imu` → `encoder` 순으로 찍힌다. 실행 순서는 클래스 안의 선언 순서만 따르고, 초기화 리스트의 순서는 실제 실행에는 영향이 없이 `-Wreorder` 경고 여부에만 영향을 준다.
2. `Base` 생성자가 실행되는 시점에는 `Derived`의 멤버들이 아직 생성되지 않았다(생성 순서: 베이스 → 멤버 → 파생은 여기선 상속 계층이므로 베이스 전체가 먼저, 파생 멤버는 그다음). 만약 `Base::init()`이 아니라 실제로 `Derived::init()`이 불렸다면 그 함수가 아직 초기화되지 않은 `Derived`의 멤버를 읽거나 쓰게 되어 미정의 동작이 된다. C++이 이 시점에 베이스 버전만 부르도록 강제하는 것은 정확히 이 사고를 막기 위한 안전장치다.
3. `knee` 생성자가 먼저 실행돼 즉시 예외를 던지므로 `hip`은 아예 만들어지지 않는다 — `[MotorDriver 생성] fd=3` 로그 자체가 찍히지 않고, 만들어진 적 없는 객체이므로 `hip`의 소멸자 로그도 없다. `catch` 블록만 `[catch] 모터 드라이버 연결 실패`를 출력한다.
4. 리팩터링 후에는 대표 생성자(인자가 가장 많은 것) 하나에만 검증 로직이 남고, 나머지는 그 생성자를 기본값과 함께 호출하는 한 줄짜리 위임으로 바뀐다. 잘못된 값을 어느 생성자로 넣어도 결국 대표 생성자를 거치므로 예외가 던져진다 — `delegating_ctor.cpp`와 같은 구조다.
5. `explicit` 없는 버전은 `set_joint_angle(3)`처럼 정수를 그대로 넘겨도 `Radians(3)`으로 암묵 변환돼 경고 없이 컴파일된다. `explicit`을 붙이면 같은 호출에서 `error: could not convert '3' from 'int' to 'Radians'` 계열 에러가 나고, 호출자는 `set_joint_angle(Radians(3))`처럼 단위를 명시해야만 통과시킬 수 있다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `construction_order.cpp`는 멤버 선언 순서를 이리저리 바꿔가며 로그 순서가 따라 바뀌는지 직접 확인하고, `virtual_call_in_constructor.cpp`는 `Derived`에 멤버 변수를 하나 추가해 생성자에서 `init()`을 부를 때 그 멤버가 어떤 값을 갖고 있는지(초기화 전이라 쓰레기값이거나 0인지) 직접 찍어 봐라. 기준 명령: `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, ASan은 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`.

**다음 절**: [3.3 상속: is-a의 비용](#/inheritance) — 이 절에서 베이스 생성자가 먼저, 소멸자가 나중에 실행된다는 것을 확인했다. 다음 절은 그 위에 얹히는 상속 관계 자체의 비용을 다룬다 — 객체 슬라이싱이 정확히 왜 일어나는지, `protected`가 캡슐화를 얼마나 깨는지, 그리고 다중 상속이 만드는 생성 순서의 복잡도까지 실측으로 확인한다.

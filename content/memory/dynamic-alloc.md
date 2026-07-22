# 2.4 new/delete와 동적 할당의 비용

::: lead
[2.1](#/memory-model)에서 힙이 스택보다 18~34배 느리다는 것을 쟀다. 이 절은 그 뒤에 숨은 더 무거운 질문을 연다 — 느린 것보다 무서운 건 **틀리기 쉽다는 것**이다. 함수 하나가 `new`로 배열을 만들고 `delete`를 깜빡한 채 끝나는 실수부터 열어, `new`/`delete`가 `malloc`/`free`와 뭐가 다른지, 짝을 잘못 맞추면 어떤 일이 나는지, 지운 포인터를 또 지우면 무슨 일이 나는지를 valgrind와 ASan으로 실측한다. 결론은 미리 말해 둔다 — 이 절 전체가 사실 "`new`/`delete`를 손으로 짝짓지 마라"는 결론을 향해 쌓는 증거다. [2.9 unique_ptr](#/unique-ptr)이 이 증거 위에 선다.
:::

## 함수 하나가 삼키는 32바이트

라이다 스캔 버퍼를 만들고 처리한 뒤 돌아가는 함수를 짜 보자. `delete[]`를 넣는 걸 잊는 실수는 놀랄 만큼 자연스럽게 일어난다 — 함수가 짧고 스코프 안에서 다 끝나는 것처럼 보이기 때문이다.

```cpp title="leak.cpp — delete[] 없이 리턴한다"
void work() {
  int* buf = new int[8];
  buf[0] = 1;
}  // delete[] 가 없다!

int main() {
  work();
  return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g leak.cpp -o leak
$ ./leak
$ echo $?
0
```

경고 하나 없이 컴파일되고, 실행하면 크래시도 없이 종료 코드 0이다. **아무 일도 없었던 것처럼 보인다.** `-Wall -Wextra`는 이 실수를 잡아내지 못한다 — `buf`가 스코프를 벗어나는 것 자체는 문법적으로 정상이라, 컴파일러는 "이 포인터가 가리키던 힙 블록을 나중에 누가 지우는지"까지는 추적하지 않는다. 이게 힙과 스택의 결정적인 차이다 — 스택 변수는 스코프가 끝나면 언어가 알아서 회수하지만, 힙 블록은 **누군가 `delete`를 불러 주지 않으면 프로그램이 끝날 때까지 그대로 남는다.**

증거는 valgrind로 잡는다.

```console
$ valgrind --leak-check=full --show-leak-kinds=all ./leak
==17769== HEAP SUMMARY:
==17769==     in use at exit: 32 bytes in 1 blocks
==17769==   total heap usage: 2 allocs, 1 frees, 73,760 bytes allocated
==17769==
==17769== 32 bytes in 1 blocks are definitely lost in loss record 1 of 1
==17769==    at 0x48485C3: operator new[](unsigned long) (vgpreload_memcheck-amd64-linux.so)
==17769==    by 0x10915E: work() (leak.cpp:2)
==17769==    by 0x10917C: main (leak.cpp:7)
==17769==
==17769== LEAK SUMMARY:
==17769==    definitely lost: 32 bytes in 1 blocks
==17769== ERROR SUMMARY: 1 errors from 1 contexts (suppressed: 0 from 0)
```

`definitely lost`가 valgrind의 언어로 "이 블록을 가리키는 포인터가 프로그램 어디에도 남아 있지 않다"는 뜻이다 — `new int[8]`이 호출된 줄(`leak.cpp:2`)까지 짚어 준다. valgrind가 없다면 `-fsanitize=address`만 붙여도 같은 정보를 실행 파일 자체가 내놓는다(LeakSanitizer).

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address leak.cpp -o leak_asan
$ ./leak_asan
==18754==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 32 byte(s) in 1 object(s) allocated from:
    #0 ... in operator new[](unsigned long) ...
    #1 ... in work() leak.cpp:2
    #2 ... in main leak.cpp:7

SUMMARY: AddressSanitizer: 32 byte(s) leaked in 1 allocation(s).
$ echo $?
1
```

일반 빌드는 종료 코드 0으로 아무 문제 없어 보였지만, LeakSanitizer가 켜진 빌드는 같은 프로그램을 종료 코드 1로 끝낸다 — 스택 트레이스는 valgrind와 똑같이 `work()`의 2번 줄을 지목한다. 두 도구 모두 "이 32바이트, 함수가 끝나는 순간 아무도 그 주소를 몰랐다"는 사실을 서로 다른 방식으로 보여줄 뿐이다.

## new/delete가 실제로 하는 일

`new`는 힙에 자리를 잡는 것에서 멈추지 않는다. `malloc`과 정확히 어디가 다른지 클래스 타입으로 확인한다.

```cpp title="mallocvsnew.cpp — 생성자를 부르는가 안 부르는가"
#include <cstdio>
#include <cstdlib>

struct Point {
    double x, y;
    Point() : x(1.0), y(2.0) { std::printf("Point() 생성자 실행, x=%.1f y=%.1f\n", x, y); }
    ~Point() { std::printf("~Point() 소멸자 실행\n"); }
};

int main() {
    std::printf("-- malloc --\n");
    Point* p1 = static_cast<Point*>(std::malloc(sizeof(Point)));
    std::printf("malloc 직후 p1->x = %f (초기화 안 됨, 생성자가 안 불렸다)\n", p1->x);
    std::free(p1);

    std::printf("-- new --\n");
    Point* p2 = new Point();
    delete p2;
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g mallocvsnew.cpp -o mallocvsnew
mallocvsnew.cpp:13:16: warning: '*p1.Point::x' is used uninitialized [-Wuninitialized]
$ ./mallocvsnew
-- malloc --
malloc 직후 p1->x = 0.000000 (초기화 안 됨, 생성자가 안 불렸다)
-- new --
Point() 생성자 실행, x=1.0 y=2.0
~Point() 소멸자 실행
```

`Point() 생성자 실행` 줄이 `malloc` 쪽에는 아예 없다. `malloc(sizeof(Point))`은 크기가 맞는 메모리 조각 하나를 내줄 뿐, 그 안에 `Point` 객체를 **만드는** 일은 전혀 하지 않는다 — g++도 이 사실을 알고 `p1->x`를 읽는 줄에 "초기화되지 않은 값을 쓴다"는 경고까지 낸다. 이 실행에서는 마침 0.0이 나왔지만, 메모리 페이지가 우연히 그랬을 뿐 언어가 보장하는 값이 아니다 — 재사용된 메모리라면 쓰레기값이 그대로 보일 수 있다. `free(p1)`도 소멸자를 부르지 않고 메모리만 반납한다. 반면 `new Point()`는 자리를 잡은 **직후 생성자를 실제로 실행**하고, `delete p2`는 반납 **직전 소멸자를 실제로 실행**한다. `new`/`delete` 한 쌍은 "메모리 할당 + 객체 생성"과 "객체 파괴 + 메모리 반납"을 각각 하나로 묶은 연산이다. `malloc`/`free`는 순수 메모리 함수라 생성자·소멸자를 전혀 모른다 — 그래서 클래스 타입에 `malloc`/`free`를 쓰는 일은 없다.

### new[]와 delete[]는 짝이 어긋나면 안 조용히 죽는다

배열 버전(`new[]`/`delete[]`)에는 단일 버전에 없는 계약이 하나 더 있다 — **몇 개를 생성했는지 기억해야 그만큼 소멸자를 부를 수 있다**는 것. 이 정보를 어디에 담을지는 표준이 정하지 않고 구현에 맡긴다. 그 구현 디테일이 어긋난 짝짓기에서 그대로 드러난다.

```cpp title="arrmismatch.cpp — new Logger[3]를 delete(단일)로 지운다"
#include <cstdio>

struct Logger {
    int id;
    Logger() : id(next_id++) { std::printf("생성자: Logger #%d\n", id); std::fflush(stdout); }
    ~Logger() { std::printf("소멸자: Logger #%d\n", id); std::fflush(stdout); }
    static inline int next_id = 0;
};

int main() {
    Logger* arr = new Logger[3];
    std::printf("-- delete (배열이 아닌 단일 객체용) 호출 --\n");
    std::fflush(stdout);
    delete arr;   // new[]는 delete[]로 지워야 한다
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g arrmismatch.cpp -o arrmismatch
arrmismatch.cpp:14:12: warning: 'void operator delete(void*, long unsigned int)' called
  on pointer returned from a mismatched allocation function [-Wmismatched-new-delete]
   14 |     delete arr;
      |            ^~~
arrmismatch.cpp:11:31: note: returned from 'void* operator new [](long unsigned int)'
$ ./arrmismatch
생성자: Logger #0
생성자: Logger #1
생성자: Logger #2
-- delete (배열이 아닌 단일 객체용) 호출 --
소멸자: Logger #0
munmap_chunk(): invalid pointer
[Aborted]
```

g++ 13.3은 `-Wall`만으로도 이 실수를 `-Wmismatched-new-delete`로 경고한다 — 그런데도 실행해 보면 값을 확인해 볼 가치가 있다. **소멸자가 `#0` 딱 하나만 불렸다.** `#1`, `#2`의 소멸자는 끝내 안 불린다 — `delete`(배열 아닌 버전)는 "객체 하나가 있다"고 믿고 첫 원소에만 소멸자를 걸기 때문이다. 그 직후 `munmap_chunk(): invalid pointer`로 프로그램이 죽는다. `new[]`는 몇 개를 생성했는지 기억해야 하므로(그래야 `delete[]`가 소멸자를 몇 번 불러야 할지 안다) 배열 앞에 그 개수를 적은 여분의 자리("배열 쿠키")를 함께 할당해 둔다. `delete`(배열 아닌 버전)는 이 쿠키를 모르고 포인터가 가리키는 자리를 그대로 반납하려 해, 실제 블록의 시작 주소가 쿠키만큼 어긋나 힙 메타데이터가 깨진다. 이 쿠키는 표준이 아니라 구현이 정하는 세부사항이라 짝이 어긋났을 때 정확히 어떻게 죽는지도 구현마다 다를 수 있다. 결론은 흔들리지 않는다. **`new[]`로 만든 것은 반드시 `delete[]`로, `new`로 만든 것은 반드시 `delete`로 지운다.**

::: note placement new는 존재만 알아 둔다
이미 확보된 메모리 위에 생성자만 실행하는 `new(ptr) T(...)` 문법(placement new)이 있다 — 커스텀 할당자, 오브젝트 풀 구현에 쓰인다. "메모리 확보"와 "객체 생성"이 이론상 분리 가능한 두 단계라는 것만 기억해 두면 충분하다.
:::

## 누수의 해부

앞의 `work()` 예제로 돌아가 그 순간을 스텝 단위로 뜯어본다.

::: widget stack-heap
{ "scenario": "leak" }
:::

스텝을 끝까지 넘겨 봐라. `work` 프레임 안에서 `buf`가 힙 블록을 가리키고 있다가, `work`가 리턴하는 순간 프레임이 통째로 걷힌다 — **`buf`라는 이름 자체가 사라진다.** 그런데 그 이름이 가리키던 32바이트는 힙에 그대로 남는다. 힙 블록은 스택 프레임처럼 "프레임이 걷히면 자동 회수"되는 게 아니기 때문이다. 마지막 스텝에서 힙 블록에 빨간 "누수!" 표시가 뜨는 것이 정확히 이 상태다 — **그 주소를 아는 변수가 프로그램 어디에도 없는데, 블록 자체는 힙에 살아 있다.** 이게 valgrind가 `definitely lost`라고 부른 것의 그림이다.

더 위험한 경로가 하나 더 있다 — 함수가 정상적으로 끝나지 않고 **예외로 중간에 빠져나가는** 경우다.

```cpp title="exleak.cpp — 예외가 delete[]를 건너뛴다"
#include <cstdio>
#include <stdexcept>

void parse_scan(bool bad_frame) {
    double* buf = new double[1000];
    buf[0] = 1.0;
    if (bad_frame) {
        throw std::runtime_error("깨진 프레임");   // delete[] buf를 건너뛴다
    }
    buf[1] = 2.0;
    delete[] buf;
}

int main() {
    try {
        parse_scan(true);
    } catch (const std::exception& e) {
        std::printf("예외 잡음: %s\n", e.what());
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address exleak.cpp -o exleak_asan
$ ./exleak_asan
예외 잡음: 깨진 프레임

=================================================================
==22404==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 8000 byte(s) in 1 object(s) allocated from:
    #0 ... in operator new[](unsigned long) ...
    #1 ... in parse_scan(bool) exleak.cpp:5
    #2 ... in main exleak.cpp:16

SUMMARY: AddressSanitizer: 8000 byte(s) leaked in 1 allocation(s).
```

`catch` 블록이 예외를 정확히 잡아 프로그램은 깔끔하게 끝난 것처럼 보이는데도 8000바이트가 새 나갔다. `throw`가 실행되는 순간 함수는 남은 코드(`buf[1] = 2.0`도, `delete[] buf`도)를 **전혀 실행하지 않고** 곧장 가장 가까운 `catch`로 건너뛴다 — 예외에 의한 함수 탈출은 "함수 끝까지 순서대로 실행됨"을 전제하지 않는다. **함수 안에 예외를 던질 수 있는 호출이 하나라도 있으면, 손으로 짝지은 `new`/`delete`는 그 하나만 놓쳐도 이런 식으로 샌다.** 이 부담을 언어 기능으로 없애는 것이 [2.5 RAII](#/raii)의 존재 이유다 — 소멸자가 어떤 경로로든 스코프를 벗어나면 자동으로 불린다는 보장이 이 문제를 구조적으로 지운다.

## 이중 해제와 use-after-free

지운 포인터를 또 지우면 어떻게 되는가도 실측해 둘 가치가 있다.

```cpp title="doublefree.cpp"
#include <cstdio>

int main() {
    int* p = new int(42);
    std::printf("p 첫 delete 전: %d\n", *p);
    delete p;
    delete p;   // 이미 해제한 포인터를 다시 delete
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g doublefree.cpp -o doublefree
$ ./doublefree
p 첫 delete 전: 42
free(): double free detected in tcache 2
[Aborted]
```

일반 빌드에서도 glibc의 할당자 자신이 이중 해제를 잡아 `Aborted`로 죽는다 — 다만 이건 이 환경의 glibc가 우연히 잡아 준 것이지 언어가 보장하는 게 아니다. 구현에 따라 이중 해제가 조용히 통과하고 힙 메타데이터만 은근히 깨지는 경우도 있다 — 그게 더 무섭다. ASan은 정확한 이름으로 짚는다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address doublefree.cpp -o doublefree_asan
$ ./doublefree_asan
==23137==ERROR: AddressSanitizer: attempting double-free on 0x502000000010 in thread T0:
    #0 ... in operator delete(void*, unsigned long) ...
    #1 ... in main doublefree.cpp:7

freed by thread T0 here:
    #0 ... in operator delete(void*, unsigned long) ...
    #1 ... in main doublefree.cpp:6

previously allocated by thread T0 here:
    #0 ... in operator new(unsigned long) ...
    #1 ... in main doublefree.cpp:4

SUMMARY: AddressSanitizer: double-free ../asan_new_delete.cpp:164 in operator delete(void*, unsigned long)
```

진단명 `double-free`와 함께, 두 번째 `delete`가 일어난 줄(7번)과 첫 번째 `delete`가 일어난 줄(6번)을 각각 짚는다 — [2.2](#/pointers)에서 본 `heap-use-after-free` 리포트와 형식이 똑같다. 실제로 이 둘은 한 가족이다. `delete p` 후 `p`를 역참조하면 `heap-use-after-free`가, `delete p`를 두 번 하면 `double-free`가 뜬다 — 둘 다 "이미 반납한 자리에 다시 손을 댔다"는 같은 원인의 다른 증상이다.

관용구로 흔히 쓰는 "지운 뒤에 `nullptr`로 만든다"가 이 둘 중 무엇을 막고 무엇을 못 막는지 정확히 알아야 한다.

```cpp title="alias.cpp — p는 안전해졌지만 alias는 아니다"
#include <cstdio>

int main() {
    int* p = new int(42);
    int* alias = p;      // p와 같은 블록을 가리키는 별칭
    delete p;
    p = nullptr;          // p 자신은 안전해졌다
    std::printf("p==nullptr, alias는 옛 주소 그대로: %d\n", *alias);  // alias는 여전히 댕글링
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g alias.cpp -o alias
$ ./alias
p==nullptr, alias는 옛 주소 그대로: 1453128791
```

`p = nullptr`은 `p` **자신을** 안전하게 만든다 — `delete p`를 실수로 한 번 더 불러도 `nullptr`에 대한 `delete`라 아무 일도 안 일어난다(`delete nullptr`은 표준이 명시적으로 허용하는 안전한 무연산이다). 그런데 `alias`는 `p`가 `nullptr`이 되는 것과 아무 상관이 없다 — 같은 블록을 가리키던 **또 다른 포인터**였을 뿐이라, `p`를 고쳐도 `alias`는 이미 해제된 옛 주소를 그대로 들고 있다. 이 실행에서는 크래시 없이 쓰레기값(`1453128791`)이 찍혔다 — 해제된 자리를 읽는 것은 UB이므로 이 값도, 크래시도, 우연히 42가 남아 있는 것도 전부 "허용된" 결과다. ASan을 붙이면 `heap-use-after-free`로 잡힌다.

::: danger `p = nullptr`은 별칭에는 소용없다
"지운 뒤 nullptr" 관용구는 **그 변수 하나**의 안전만 보장한다. 같은 블록을 가리키는 포인터가 둘 이상이면(별칭), 하나를 `delete`하고 `nullptr`로 만들어도 나머지는 여전히 댕글링이다. 신뢰할 수 있는 경우는 그 포인터가 블록의 **유일한** 소유자일 때뿐이다 — "유일한 소유자"를 타입 시스템 수준에서 강제하는 것이 정확히 [2.9 unique_ptr](#/unique-ptr)이다.
:::

## new의 실패

`new`가 요청한 메모리를 구하지 못하면 어떻게 되는지도 실측한다. 기본 동작은 예외를 던지는 것이다.

```cpp title="badalloc.cpp"
#include <cstdio>
#include <new>
#include <cstddef>

int main() {
    // 요청 자체는 합법적인 크기지만, 실제 RAM+스왑을 아득히 넘는 양이다.
    std::size_t count = 500'000'000'000ULL;  // int 5000억 개, 약 1.8TB

    try {
        int* p = new int[count];
        p[0] = 1;   // 여기까지 오지 않는다
    } catch (const std::bad_alloc& e) {
        std::printf("bad_alloc 잡음: %s\n", e.what());
    }

    int* q = new(std::nothrow) int[count];
    if (q == nullptr) {
        std::printf("nothrow: 할당 실패, q == nullptr, 예외 없이 반환\n");
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -g badalloc.cpp -o badalloc
$ ./badalloc
bad_alloc 잡음: std::bad_alloc
nothrow: 할당 실패, q == nullptr, 예외 없이 반환
```

기본 `new`는 요청을 못 채우면 `std::bad_alloc` 예외를 던진다 — 잡지 않으면 프로그램이 `terminate`로 죽는다. `new(std::nothrow)`는 예외 대신 `nullptr`을 돌려준다. 실무에서 힙 할당 실패는 흔한 사건이 아니다 — 운영체제가 메모리를 넉넉히 남겨 두는 한 거의 항상 성공한다. 진짜 문제는 성공/실패의 이분법이 아니라, [2.1](#/memory-model)에서 짚었듯 **성공하기까지 걸리는 시간에 상한이 없다**는 것이다. 임베디드·실시간 환경은 그래서 `bad_alloc`을 잡기보다 **애초에 실행 중 힙 할당 자체를 안 하는** 전략을 쓴다 — 시작 시점에 필요한 만큼을 확보해 두고, 루프 안에서는 그 버퍼를 재사용만 한다. 이 설계를 [6.8 실시간 제약과 제어 루프](#/realtime)에서 다룬다.

## 그래서 직접 new/delete를 쓰지 않는다

이 절에서 실측한 것을 한 줄로 모으면 이렇다 — 짝을 하나만 깜빡해도 새고(누수), 짝의 종류를 잘못 맞춰도 죽고(`new[]`/`delete[]` 불일치), 같은 것을 두 번 지워도 죽고(이중 해제), 지운 걸 또 써도 죽는다(use-after-free). 넷 다 컴파일러가 대신 잡아 주지 않는다 — valgrind·ASan을 붙여야 드러난다. **이 절 전체가 사실 "`new`/`delete`를 손으로 짝짓지 마라"는 결론을 향한 증거 수집이었다.** 자원 하나를 획득·반납하는 짝을 손으로 관리하는 코드는, 그 자원이 살아 있는 모든 실행 경로(정상 리턴, 여러 `return`, 예외)에서 그 짝을 빠짐없이 맞춰야 한다 — 코드 리뷰로 백 번 확인해도 백한 번째 수정에서 깨질 수 있는 규율이다. [2.5 RAII](#/raii)는 이 규율을 소멸자 하나에 넘겨 "빠뜨릴 수 없는" 구조로 만들고, [2.9 unique_ptr](#/unique-ptr)은 그 RAII를 포인터 모양으로 포장해 이 절의 네 실수를 전부 타입 시스템 수준에서 막는다 — 소유자가 하나뿐임을 컴파일러가 강제하므로 이중 해제도 불일치도 애초에 코드에 나타나지 않는다.

로봇 제어 코드에는 이유가 하나 더 붙는다. 다리 관절을 1kHz로 제어하는 루프 안에서 진짜 문제는 배율이 아니라 **매 주기 `new`를 부를 때 그 한 번이 얼마나 걸릴지 아무도 보장 못 한다는 것**이다. 자유 리스트가 비어 있으면 시스템 콜까지 번질 수 있고, 이 지연은 예측 불가능하다 — 늦게 도착한 제어 명령이 다리 하나의 접지 타이밍을 깨뜨린다. 실시간 루프는 그래서 시작 시점에 버퍼를 전부 확보해 두고 루프 안에서는 `new`/`delete`를 아예 안 부른다 — [6.8](#/realtime)에서 구체적인 수치와 함께 다룬다.

::: interview 메모리 누수 방지, new/delete와 malloc/free의 차이
**① 누수 방지**: 근본 처방은 "손으로 `new`/`delete`를 짝짓지 않는다"다 — `unique_ptr`/`shared_ptr`이 소멸자에서 자동 해제해, 정상 리턴이든 예외든 짝이 보장된다(RAII). 발생을 잡는 도구는 valgrind와 LeakSanitizer — 둘 다 할당 지점까지 스택 트레이스로 짚는다. **② new/delete 대 malloc/free**: `new`/`delete`는 메모리 할당에 생성자·소멸자 호출을 더한 연산이고, `malloc`/`free`는 타입을 몰라 생성자·소멸자를 부르지 않는다(이 절의 `Point` 실측이 증거다). `new`는 실패 시 예외를 던지고 `malloc`은 `nullptr`을 반환한다는 규약 차이까지 답하면 상급이다.
:::

## 요약

- `delete[]` 없이 함수가 리턴하면 그 힙 블록은 프로그램이 끝날 때까지 회수되지 않는다 — 일반 빌드는 종료 코드 0이었지만 valgrind와 LeakSanitizer 둘 다 정확한 할당 줄을 짚어 `definitely lost`/`leaked`로 잡았다(실측).
- `new`/`delete`는 메모리 할당에 생성자·소멸자 호출을 더한 것이다 — `malloc`/`free`는 타입을 몰라 생성자·소멸자를 부르지 않는다(실측).
- `new[]`로 만든 것을 `delete`(배열 아닌 버전)로 지우면 소멸자가 첫 원소에만 불리고 그 직후 힙이 깨진다(실측: `munmap_chunk(): invalid pointer`) — g++는 `-Wmismatched-new-delete`로 경고한다.
- 예외로 함수를 탈출하면 그 이후의 `delete`/`delete[]`는 건너뛰어진다 — 이게 RAII([2.5](#/raii))가 필요한 근본 이유다.
- 지운 포인터를 또 지우면 `double-free`, 지운 자리를 또 읽으면 `heap-use-after-free`다(ASan 실측) — `delete` 후 `nullptr` 대입은 그 변수 자신만 안전하게 만들 뿐 별칭에는 소용없다.
- `new`가 요청을 못 채우면 기본은 `bad_alloc` 예외, `new(std::nothrow)`는 `nullptr` 반환이다 — 실시간 제어 루프에서는 실패 처리보다 애초에 루프 안에서 `new`를 안 부르는 설계([6.8](#/realtime))가 답이다.
- 이 절의 네 가지 실수(누수, `new[]`/`delete[]` 불일치, 이중 해제, use-after-free) 전부가 [2.9 unique_ptr](#/unique-ptr)에서 타입 시스템 수준에서 막힌다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 valgrind 또는 ASan으로 직접 재현하는 실습이다.

1. `malloc(sizeof(Point))` 직후 `p1->x`를 읽는 것이 왜 `new Point()` 직후 `p2->x`를 읽는 것과 다른가. "생성자가 불렸는가"의 관점에서 설명하라.

2. `delete p; p = nullptr;` 관용구가 안전하게 만드는 것과 못 만드는 것을 각각 하나씩 대라. 후자를 근본적으로 막는 도구는 무엇인가.

3. (실습, 코드 작성형) `work()`의 배열 크기를 8에서 800,000으로 늘린 프로그램을 짜고 `valgrind --leak-check=full --show-leak-kinds=all`로 돌려라. 성공 기준: `definitely lost` 바이트 수가 `800000 * sizeof(int)`와 일치했다.

4. (실습, 코드 작성형) `arrmismatch.cpp`를 그대로 치고, `delete arr;`를 `delete[] arr;`로 고친 버전을 따로 만들어 둘 다 실행하라. 성공 기준: 원래 버전은 소멸자가 하나만 불리고 비정상 종료, 고친 버전은 세 소멸자가 다 불리고 종료 코드 0인 것을 확인했다.

5. (실습, 코드 작성형) `int* p = new int(1);`을 두 번 `delete`하는 코드를 ASan으로 빌드해 실행하고, 리포트의 `freed by thread T0 here`와 `previously allocated by thread T0 here`가 각각 몇 번째 `delete p;`/`new int(1)`을 가리키는지 리포트만 보고 맞혀라.
:::

::: answer 해설
1. `malloc`은 크기가 맞는 메모리 조각만 내줄 뿐 `Point` 객체를 만드는 절차(멤버 초기화, 생성자 본문)를 전혀 수행하지 않는다 — `p1->x`는 아직 아무도 채운 적 없는 메모리다. `new Point()`는 자리를 잡은 직후 반드시 `Point()` 생성자를 실행하므로 `p2->x`는 생성자가 써 넣은 1.0이다. 이 차이가 클래스 타입에 `malloc`/`free`를 쓰지 않는 이유다.
2. 안전하게 만드는 것: `p` 자신을 통한 재사용(`delete nullptr`은 표준이 허용하는 무연산). 못 만드는 것: 같은 블록을 가리키던 별칭(`alias`)을 통한 접근 — `p`를 `nullptr`로 바꿔도 `alias`는 여전히 댕글링이다. 근본적으로 막는 도구는 소유자가 정확히 하나임을 강제하는 `std::unique_ptr`이다.
3. 800,000개의 `int`는 4바이트 기준 3,200,000바이트다. `LEAK SUMMARY`의 `definitely lost`가 이 값과 정확히 일치해야 하고, 스택 트레이스는 `new int[800000]` 줄을 가리켜야 한다.
4. 원래(`delete arr;`) 버전: 생성자 세 줄이 다 찍힌 뒤 소멸자는 `#0` 하나만 찍히고 힙 손상 에러로 비정상 종료한다. 고친(`delete[] arr;`) 버전: 소멸자도 `#0`, `#1`, `#2` 세 줄 모두 찍히고 `echo $?`가 0을 낸다.
5. `freed by thread T0 here`는 두 번째가 아니라 **첫 번째** `delete p;` 줄을 가리킨다 — "여기서 이미 해제됐다"는 뜻이다. `previously allocated by thread T0 here`는 `new int(1)` 줄을 가리킨다 — "여기서 태어났다"는 뜻이다. 리포트 맨 위에서 스택 트레이스만으로 나오는 에러 위치가 지금 실패한 두 번째 `delete p;`다.
:::

이 절의 코드는 전부 직접 쳐라. `leak.cpp`는 일반 빌드와 `-fsanitize=address` 빌드를 둘 다 돌려서 차이를 눈으로 봐라. `arrmismatch.cpp`는 컴파일 경고가 실제로 뜨는 것과, 무시하고 실행했을 때 소멸자가 몇 번만 불리고 죽는 것을 순서대로 확인해라. valgrind가 없는 환경에서는 모든 실습을 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`으로 대체할 수 있다.

**다음 절**: [2.5 RAII: 소멸자가 자원을 관리한다](#/raii) — 이 절 전체가 예고한 답으로 들어간다. "함수를 나가는 모든 경로에서 반드시 실행되는 정리 코드"를 소멸자 하나로 구현하는 법, 그리고 그게 왜 C++에서 가장 중요한 관용구인지를 다룬다.

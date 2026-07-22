# 2.5 RAII: 소멸자가 자원을 관리한다

::: lead
파일을 열고, 중간에 에러 조건을 만나 함수를 빠져나가는 코드는 실무에서 하루에도 몇 번씩 짠다. 그리고 그 "중간에 빠져나가는" 경로 하나마다 `fclose`를 잊을 확률이 붙는다 — 실제로 파일 디스크립터 개수를 세어 그 누수를 눈으로 확인하는 것으로 이 절을 시작한다. [2.1](#/memory-model)의 위젯에서 함수 프레임이 스코프를 벗어나는 순간 통째로 걷히는 것을 봤다. 그 "걷히는 순간"에 소멸자를 끼워 넣어, 프레임이 사라질 때 자원도 함께 놓게 만드는 것이 RAII다. C++에 `try`/`finally`가 없는데도 예외 안전한 코드를 짤 수 있는 이유가 이 관용구 하나다 — 이 책 전체에서 가장 자주 등장할 이름이다.
:::

## 열어 놓고 잊는 사고를 실측한다

센서 로그 파일을 읽는 함수를 하나 짜 보자. 파일을 열고, 첫 줄을 읽다가 예상과 다른 상황을 만나면 즉시 함수를 빠져나간다 — 에러 처리 코드에서 흔히 나오는 모양이다.

```cpp title="fdleak.cpp — 중간 return이 fclose를 건너뛴다"
#include <cstdio>
#include <dirent.h>

int count_open_fds() {
    int count = 0;
    DIR* dir = opendir("/proc/self/fd");
    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        if (entry->d_name[0] != '.') count++;
    }
    closedir(dir);
    return count;
}

void process_bad(const char* path, bool simulate_error) {
    FILE* fp = std::fopen(path, "r");
    if (fp == nullptr) return;
    char buf[16];
    std::fgets(buf, sizeof(buf), fp);
    if (simulate_error) {
        std::printf("에러 조건 발생 — 여기서 함수를 빠져나간다\n");
        return;              // fclose(fp)를 잊었다 — fd 누수
    }
    std::fclose(fp);
}

int main() {
    std::printf("시작 시 열린 fd 개수: %d\n", count_open_fds());
    for (int i = 0; i < 5; ++i) {
        process_bad("/etc/hostname", true);
    }
    std::printf("5번 호출 후 열린 fd 개수: %d\n", count_open_fds());
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra fdleak.cpp -o fdleak
$ ./fdleak
시작 시 열린 fd 개수: 4
에러 조건 발생 — 여기서 함수를 빠져나간다
에러 조건 발생 — 여기서 함수를 빠져나간다
에러 조건 발생 — 여기서 함수를 빠져나간다
에러 조건 발생 — 여기서 함수를 빠져나간다
에러 조건 발생 — 여기서 함수를 빠져나간다
5번 호출 후 열린 fd 개수: 9
```

(g++ 13.3 / Linux x86-64 실측.) `/proc/self/fd`는 지금 이 프로세스가 열어 둔 파일 디스크립터를 리눅스 커널이 그대로 보여 주는 가상 디렉터리다 — `lsof -p <pid>`가 화면에 찍어 주는 것과 같은 정보를 직접 세어 확인한 것이다. 시작할 때 4개였던 fd가 `process_bad`를 5번 부른 뒤 정확히 5개 늘어 9개가 됐다 — 매 호출마다 `fopen`은 성공했는데 `fclose`가 한 번도 실행되지 않았다는 뜻이다. 이 프로그램은 곧 끝나니 운영체제가 프로세스 종료와 함께 전부 회수하지만, 로봇 제어 노드처럼 며칠을 계속 도는 프로세스라면 이 카운터는 계속 늘어난다. 리눅스는 프로세스당 열 수 있는 fd 개수에 상한(`ulimit -n`)을 두므로, 이 함수가 하루에 수천 번 불리는 코드라면 언젠가 `fopen`이 `nullptr`을 반환하기 시작한다 — 그것도 원인과 한참 떨어진, 완전히 다른 곳에서 파일을 여는 코드가 실패하는 형태로 터진다.

문제의 본질은 "실수로 `fclose`를 빼먹었다"가 아니다. **함수를 빠져나가는 경로가 여러 개일 때마다 그 경로 각각에 해제 코드를 손으로 복사해 넣어야 한다**는 설계 자체가 문제다. `if`가 하나 늘 때마다, `catch`가 하나 늘 때마다 해제를 잊을 자리가 하나씩 늘어난다.

## 소멸자는 약속이다

해법은 "해제를 잊지 않도록 조심한다"가 아니라 **해제를 조심할 필요가 없는 구조로 바꾸는 것**이다. C++ 클래스의 소멸자는 그 객체가 소멸하는 순간 자동으로 호출된다는 것을 [3.2 생성자와 소멸자](#/constructors)에서 정식으로 다루지만, 지금 확인할 사실 하나로 충분하다. **객체가 스코프를 벗어나는 모든 경로에서, 예외 없이, 소멸자가 호출된다.** 정상적으로 함수 끝에 도달해도, 중간에 `return`으로 빠져나가도, 예외가 던져져도 마찬가지다. 세 경로 전부를 직접 찍어 본다.

```cpp title="threepaths.cpp — 세 가지 탈출 경로 모두에서 소멸자가 불린다"
#include <cstdio>
#include <stdexcept>

struct Logger {
    const char* name;
    explicit Logger(const char* n) : name(n) { std::printf("[생성] %s\n", name); }
    ~Logger() { std::printf("[소멸] %s\n", name); }
};

void normal_return() {
    Logger log("normal_return");
    std::printf("정상 경로 실행 중\n");
}

void early_return() {
    Logger log("early_return");
    std::printf("조건 만족 — 중간에 return\n");
    return;
    std::printf("여기는 실행되지 않는다\n");
}

void throws() {
    Logger log("throws");
    std::printf("예외를 던지기 직전\n");
    throw std::runtime_error("boom");
}

int main() {
    std::printf("--- 1. 정상 반환 ---\n");
    normal_return();

    std::printf("--- 2. 중간 return ---\n");
    early_return();

    std::printf("--- 3. 예외 ---\n");
    try {
        throws();
    } catch (const std::exception& e) {
        std::printf("[catch] %s\n", e.what());
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra threepaths.cpp -o threepaths
$ ./threepaths
--- 1. 정상 반환 ---
[생성] normal_return
정상 경로 실행 중
[소멸] normal_return
--- 2. 중간 return ---
[생성] early_return
조건 만족 — 중간에 return
[소멸] early_return
--- 3. 예외 ---
[생성] throws
예외를 던지기 직전
[소멸] throws
[catch] boom
```

(g++ 13.3 실측.) 세 함수 전부 `Logger` 객체 하나만 만들었을 뿐, 소멸을 부르는 코드는 어디에도 없다. 그런데도 세 경로 모두에서 `[소멸]`이 정확히 한 번씩 찍혔다 — 특히 3번이 핵심이다. `throw`가 실행되는 순간 컴파일러는 **스택 되감기(stack unwinding)**를 시작한다. `throws` 함수가 정상적으로 `return`하는 게 아니라 예외로 중단되는데도, 그 프레임에 있던 지역 객체 `log`의 소멸자는 `catch` 블록에 도달하기 전에 이미 호출된다 — 로그 출력 순서(`[소멸] throws`가 `[catch] boom`보다 먼저)가 그 증거다. [2.1](#/memory-model)의 위젯이 보여준 "프레임이 걷히면 그 안의 모든 것이 함께 사라진다"는 그림이, 예외라는 비정상 경로에서도 똑같이 성립한다는 뜻이다.

**생성자에서 자원을 얻고 소멸자에서 놓는다** — 이 한 문장이 RAII(Resource Acquisition Is Initialization, 자원 획득이 곧 초기화다)의 전부다. 파일 핸들, 락, 힙 메모리, 소켓, 이 모두가 "자원"이고, 이들을 여는 시점을 생성자에, 닫는 시점을 소멸자에 못박아 두면 "언제 닫아야 하는가"라는 질문 자체가 사라진다. 답은 항상 "객체가 죽을 때"이고, 그 시점은 컴파일러가 스코프 규칙에 따라 자동으로 결정해 준다.

## 직접 만드는 RAII 래퍼: FileGuard

이 원리를 눈으로 확인하는 가장 빠른 방법은 위 `fdleak.cpp`가 손으로 하던 일을 클래스 하나로 옮겨 보는 것이다.

```cpp title="fileguard.cpp — fopen/fclose를 소멸자에 못박는다"
#include <cstdio>
#include <stdexcept>

class FileGuard {
public:
    FileGuard(const char* path, const char* mode) {
        fp_ = std::fopen(path, mode);
        if (fp_ == nullptr) throw std::runtime_error("파일을 열 수 없다");
        std::printf("[FileGuard 생성] %s 열림\n", path);
    }
    ~FileGuard() {
        std::fclose(fp_);
        std::printf("[FileGuard 소멸] 닫힘\n");
    }
    FILE* get() const { return fp_; }

private:
    FILE* fp_;
};

void read_config(bool simulate_error) {
    FileGuard guard("/etc/hostname", "r");   // 생성자에서 fopen
    char buf[64];
    std::fgets(buf, sizeof(buf), guard.get());
    if (simulate_error) {
        std::printf("에러 조건 — 중간에 return\n");
        return;                              // guard의 소멸자가 여기서 호출된다
    }
    std::printf("정상 종료\n");
}

int main() {
    std::printf("=== simulate_error = true ===\n");
    read_config(true);
    std::printf("=== simulate_error = false ===\n");
    read_config(false);
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra fileguard.cpp -o fileguard
$ ./fileguard
=== simulate_error = true ===
[FileGuard 생성] /etc/hostname 열림
에러 조건 — 중간에 return
[FileGuard 소멸] 닫힘
=== simulate_error = false ===
[FileGuard 생성] /etc/hostname 열림
정상 종료
[FileGuard 소멸] 닫힘
```

(g++ 13.3 실측.) `read_config`의 두 갈래 모두 `fclose`를 직접 호출한 적이 없는데도 `guard`가 스코프를 벗어나는 순간(`return`이든, 함수 끝이든) 소멸자가 알아서 파일을 닫았다. `fdleak.cpp`의 `process_bad`와 비교하면 차이가 정확히 하나다 — **"닫아라"를 코드 경로마다 반복하는 대신, 딱 한 번 소멸자에 적었다.**

그런데 이 `FileGuard`에는 아직 구멍이 있다. 클래스에 아무것도 손대지 않으면 컴파일러가 **기본 복사 생성자**를 만들어 주는데, 이 기본 복사는 멤버를 있는 그대로 복사한다 — 포인터 `fp_`도 예외가 아니다. `FileGuard b = a;`라고 쓰면 `b.fp_`와 `a.fp_`가 **같은 `FILE*`를 가리키는 두 개의 서로 다른 객체**가 되고, 둘 다 자기가 유일한 주인이라 믿고 소멸자에서 `fclose`를 부른다.

```cpp title="fileguard_doubleclose.cpp — 얕은 복사가 만드는 이중 해제"
#include <cstdio>
#include <stdexcept>

class FileGuard {
public:
    FileGuard(const char* path, const char* mode) {
        fp_ = std::fopen(path, mode);
        if (fp_ == nullptr) throw std::runtime_error("파일을 열 수 없다");
        std::printf("[FileGuard 생성] fp_ = %p\n", (void*)fp_);
    }
    ~FileGuard() {
        std::printf("[FileGuard 소멸] fclose(%p) 시도\n", (void*)fp_);
        std::fclose(fp_);
    }
    FILE* get() const { return fp_; }

private:
    FILE* fp_;   // 기본 복사 생성자가 이 포인터를 그대로 복제한다
};

int main() {
    FileGuard a("/etc/hostname", "r");
    {
        FileGuard b = a;   // 얕은 복사 — b.fp_ 도 같은 FILE*
        std::printf("b 스코프 끝\n");
    }   // 여기서 b 소멸 -> fclose(fp_) 1차 호출
    std::printf("main 계속 진행\n");
    return 0;
}   // 여기서 a 소멸 -> 같은 fp_에 fclose 2차 호출 (이중 해제)
```

```console
$ g++ -std=c++20 -Wall -Wextra fileguard_doubleclose.cpp -o dclose
$ ./dclose
free(): double free detected in tcache 2
Aborted (core dumped)
```

(g++ 13.3 / Linux x86-64 실측.) glibc의 메모리 할당자가 스스로 이중 해제를 감지해 `Aborted`로 죽였다 — 이 환경에서는 이렇게 나왔지만, 이중 해제 자체는 표준상 미정의 동작(UB)이라 항상 이 메시지로 죽는다는 보장은 없다. ASan(`-fsanitize=address`)을 붙이면 어느 줄에서 몇 번째 해제가 일어났는지까지 정확히 짚어 준다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address fileguard_doubleclose.cpp -o dclose_asan
$ ./dclose_asan
==26060==ERROR: AddressSanitizer: attempting double-free on 0x515000000080 in thread T0:
    #5 0x... in FileGuard::~FileGuard() fileguard_doubleclose.cpp:13
    #6 0x... in main fileguard_doubleclose.cpp:29
...
freed by thread T0 here:
    #5 0x... in FileGuard::~FileGuard() fileguard_doubleclose.cpp:13
    #6 0x... in main fileguard_doubleclose.cpp:26
```

`attempting double-free`라는 진단명 그대로, 13번 줄(소멸자의 `fclose`)이 두 번(26번 줄의 `b` 소멸, 29번 줄의 `a` 소멸) 실행됐다는 것을 스택 트레이스 두 벌로 보여준다. **RAII 클래스를 만들 때는 "복사하면 무슨 일이 일어나는가"를 반드시 함께 설계해야 한다** — 복사를 아예 막을지(`= delete`), 소유권을 넘길지(이동), 공유 카운트로 관리할지는 [2.6 복사 시맨틱](#/copy-semantics)과 [2.8 Rule of 0/3/5](#/rule-of-five)의 몫이다. **RAII는 "소멸자에서 해제한다"까지만 해결한다. "복사되면 어떻게 되는가"는 별도로 답해야 하는 질문이다.**

## 표준 라이브러리는 RAII로 가득하다

`FileGuard`를 손으로 만들어 본 이유는 원리를 눈으로 보기 위해서였다. 실전에서는 표준 라이브러리가 이미 만들어 둔 RAII 클래스를 쓴다 — 그리고 알고 보면 지금까지 아무 생각 없이 쓰던 도구 대부분이 RAII였다.

```cpp title="stdraii.cpp — 이미 써 왔던 RAII들"
#include <cstdio>
#include <fstream>
#include <memory>
#include <mutex>
#include <vector>

struct Sensor {
    Sensor() { std::printf("[Sensor 생성]\n"); }
    ~Sensor() { std::printf("[Sensor 소멸]\n"); }
};

std::mutex g_mtx;

void locked_section() {
    std::lock_guard<std::mutex> lock(g_mtx);   // 생성자에서 lock()
    std::printf("[임계 구역] 잠금 상태에서 실행 중\n");
}   // lock의 소멸자에서 unlock() — try/finally 없이도 항상 풀린다

void unique_ptr_demo() {
    auto s = std::make_unique<Sensor>();
    std::printf("[unique_ptr] 사용 중\n");
}   // s의 소멸자가 Sensor의 소멸자를 부른다 — delete를 쓴 적이 없다

void fstream_demo() {
    std::ofstream out("raii_demo.txt");
    out << "hello\n";
    std::printf("[ofstream] 쓰기 완료, close() 호출한 적 없음\n");
}   // out의 소멸자가 파일을 닫는다

void vector_demo() {
    std::vector<int> v(1000, 42);
    std::printf("[vector] size=%zu, capacity=%zu\n", v.size(), v.capacity());
}   // v의 소멸자가 내부 힙 버퍼를 delete한다

int main() {
    locked_section();
    unique_ptr_demo();
    fstream_demo();
    vector_demo();
    std::printf("모든 함수가 자원 해제 코드를 한 줄도 쓰지 않고 끝났다\n");
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -pthread stdraii.cpp -o stdraii
$ ./stdraii
[임계 구역] 잠금 상태에서 실행 중
[Sensor 생성]
[unique_ptr] 사용 중
[Sensor 소멸]
[ofstream] 쓰기 완료, close() 호출한 적 없음
[vector] size=1000, capacity=1000
모든 함수가 자원 해제 코드를 한 줄도 쓰지 않고 끝났다
```

(g++ 13.3 실측.) 넷 다 뜯어보면 위의 `FileGuard`와 똑같은 뼈대다.

- **`std::lock_guard`**: 생성자에서 뮤텍스를 잠그고 소멸자에서 푼다. `unlock()`을 직접 부르는 코드를 실무에서 볼 일이 거의 없는 이유다 — 락을 건 뒤 예외가 나도 반드시 풀린다. [6.3 mutex와 락 가드](#/mutex)에서 `unique_lock`·`scoped_lock`까지 정식으로 다룬다.
- **`std::unique_ptr`**: `new`로 만든 객체의 소유권을 들고 있다가 소멸자에서 `delete`를 대신 불러 준다. [2.9 unique_ptr](#/unique-ptr)이 이 클래스로 파트 전체를 연다 — `FileGuard`가 파일에 하던 일을 임의 타입에 일반화한 것이 `unique_ptr`이다.
- **`std::fstream`**: 생성자에서 파일을 열고 소멸자에서 닫는다 — 위 코드에서 `close()`를 한 번도 호출하지 않았는데도 파일은 정상적으로 닫혀 데이터가 반영됐다.
- **`std::vector`**: 힙에 배열을 들고 있다가 소멸자에서 그 버퍼를 `delete`한다. `v`가 스코프를 벗어나는 순간 1000개짜리 배열 전체가 회수된다.

::: tip 표준 라이브러리를 볼 때 습관적으로 던질 질문
새 표준 타입을 배울 때 "생성자가 무엇을 얻고, 소멸자가 무엇을 놓는가"를 먼저 물어라. 나머지 절반은 복사·이동 시 그 자원을 어떻게 다루는가([2.6](#/copy-semantics)~[2.10](#/shared-ptr))다.
:::

## 예외 안전성과 RAII

파이썬, 자바, C#은 `try`/`finally`(또는 `with`/`using`)로 "예외가 나든 안 나든 이 코드는 실행하라"를 표현한다. C++에는 `finally`가 없다 — 위원회가 실수로 빠뜨린 게 아니라 **RAII가 이미 그 자리를 대신하기 때문에 필요가 없다**는 것이 표준의 입장이다. `finally` 블록에 "자원 해제 코드"를 적는 대신, RAII는 그 해제 코드를 소멸자 안에 한 번만 적어 두고 모든 호출 지점에서 재사용한다. 직접 비교해 본다.

```cpp title="exceptsafe.cpp — 수동 관리 대 RAII, 예외가 났을 때"
#include <cstdio>
#include <memory>
#include <stdexcept>

struct Resource {
    int id;
    explicit Resource(int i) : id(i) { std::printf("[획득] 자원 %d\n", id); }
    ~Resource() { std::printf("[해제] 자원 %d\n", id); }
};

void manual_version(bool fail) {
    Resource* a = new Resource(1);
    if (fail) {
        throw std::runtime_error("중간 실패");   // a가 delete되지 않는다 — 누수
    }
    delete a;
}

void raii_version(bool fail) {
    auto a = std::make_unique<Resource>(1);
    if (fail) {
        throw std::runtime_error("중간 실패");   // 스택 되감기 중 a의 소멸자가 호출된다
    }
}

int main() {
    std::printf("=== 1. 수동 관리 + 예외 ===\n");
    try {
        manual_version(true);
    } catch (const std::exception& e) {
        std::printf("[catch] %s — 자원 1의 [해제] 로그가 안 보인다\n", e.what());
    }

    std::printf("=== 2. RAII(unique_ptr) + 예외 ===\n");
    try {
        raii_version(true);
    } catch (const std::exception& e) {
        std::printf("[catch] %s\n", e.what());
    }
    return 0;
}
```

```console
$ g++ -std=c++20 -Wall -Wextra exceptsafe.cpp -o exceptsafe
$ ./exceptsafe
=== 1. 수동 관리 + 예외 ===
[획득] 자원 1
[catch] 중간 실패 — 자원 1의 [해제] 로그가 안 보인다
=== 2. RAII(unique_ptr) + 예외 ===
[획득] 자원 1
[해제] 자원 1
[catch] 중간 실패
```

(g++ 13.3 실측.) `manual_version`은 `[획득]`만 찍고 `[해제]`가 끝내 안 나온다 — `delete a;`가 있는 줄까지 실행이 도달하지 못하고 그 위에서 예외가 던져졌기 때문이다. `raii_version`은 `[해제]`가 `catch`보다 먼저, 정확히 한 번 찍힌다. LeakSanitizer(ASan에 포함)로 확인하면 이 차이가 진단으로도 드러난다.

```console
$ g++ -std=c++20 -Wall -Wextra -g -fsanitize=address exceptsafe.cpp -o exceptsafe_asan
$ ./exceptsafe_asan
...
==27528==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 4 byte(s) in 1 object(s) allocated from:
    #1 0x... in manual_version(bool) exceptsafe.cpp:12
    #2 0x... in main exceptsafe.cpp:29

SUMMARY: AddressSanitizer: 4 byte(s) leaked in 1 allocation(s).
```

`manual_version`이 만든 4바이트(`Resource` 하나)가 정확히 짚혔고, `raii_version` 쪽 누수는 리포트에 없다 — 소멸자가 예외 경로에서도 자원을 놓았다는 뜻이다. **"예외가 나도 자원이 안전한가"라는 질문에 RAII는 코드 작성자가 매 함수마다 신경 쓸 필요 없이 "그렇다"로 답한다.** 예외가 던져지는 순간부터 그것을 잡는 `catch`에 도달하기까지, 그 사이에 있는 모든 스택 프레임의 지역 객체가 소멸자를 통해 자원을 놓는다 — `threepaths.cpp`의 3번 경로가 보여준 스택 되감기가 바로 이 메커니즘이고, 함수 호출이 열 개, 백 개로 중첩돼 있어도 마찬가지다. 이것이 "RAII가 C++에서 예외에 안전한 사실상 유일하고 실용적인 방법"이라고 불리는 이유다.

::: hist 왜 C++은 finally 대신 소멸자를 택했나
`finally`는 "여기 이 코드를 마지막에 실행하라"는 명령형 지시다 — 자원을 여는 코드와 닫는 코드를 여전히 손으로 짝지어야 하고, 그 짝을 빠뜨리면 컴파일러는 알 도리가 없다. 반대로 소멸자는 **타입 시스템에 자원 해제를 새겨 넣는다** — `FileGuard` 객체가 하나 존재하면 그 객체는 반드시 언젠가 소멸하고, 소멸자는 반드시 호출된다. 클래스를 딱 한 번 잘 설계해 두면 "닫는 것을 잊을 수 있는가"라는 질문 자체가 이후 그 클래스를 쓰는 모든 코드에서 사라진다 — 실수를 사람의 주의력이 아니라 컴파일러가 강제하는 규칙으로 막는다는, C++이 자주 내세우는 설계 철학이 여기서도 그대로 나타난다.
:::

## RAII로 못 지키는 것

RAII가 만능은 아니다. 이 관용구가 기대는 전제 하나는 **"스코프가 끝나면 그 안의 지역 객체가 소멸한다"**는 것이다. 이 전제 자체가 깨지는 상황에서는 RAII도 손을 놓는다.

가장 흔한 예는 **자원을 다른 스레드에 넘긴 경우**다. 뮤텍스를 잠그는 `lock_guard`를 지역 변수로 만들었다가 그 락을 쥔 채로 백그라운드 스레드에 작업을 맡기고 원래 함수가 먼저 끝나 버리면, `lock_guard`의 소멸자는 정직하게 락을 풀지만 그 순간 다른 스레드는 아직 락이 걸려 있다고 믿고 있던 자료구조에 접근할 수도 있다. RAII는 "스코프가 끝나면 자원을 놓는다"만 보장하지 "아무도 안 쓰고 있을 때 놓는다"는 보장하지 못한다 — 그 판단은 여전히 프로그래머의 몫이다. `std::thread`를 `detach()`해서 원래 스코프와 완전히 분리해 버리면 그 스레드 안의 자원은 어떤 소멸자의 관할도 아니게 된다 — [6.1 std::thread](#/threads)가 "왜 detach를 피하는가"로 이 문제를 다룬다.

또 하나는 **소멸자 자체가 실패할 수 있는 상황**이다. 소멸자 안에서 예외를 던지면, 이미 다른 예외로 스택 되감기가 진행 중일 때 `std::terminate`가 호출돼 프로그램이 그 자리에서 죽는다 — 예외 두 개가 동시에 날아다니는 것을 표준이 감당하지 않기 때문이다. 그래서 관용적으로 **소멸자는 예외를 던지지 않는다.** `FileGuard`의 소멸자가 `fclose` 실패를 조용히 넘긴 이유가 이것이다 — 실패를 꼭 알아야 한다면 별도의 `close()` 멤버 함수를 만들어 명시적으로 부르게 하고, 소멸자는 마지막 안전망으로만 쓴다.

## 로봇 제어 코드에서의 RAII

`ros2_control`의 `hardware_interface`는 실제 모터·센서와의 연결을 여닫는 코드를 RAII로 감싼다 — 드라이버가 소켓이든 시리얼 포트든 공유 메모리든, 그 핸들을 쥔 객체의 소멸자에서 연결 해제를 보장하는 구조다. 노드가 비정상 종료되거나 `lifecycle` 전이 도중 예외가 나도 열려 있던 하드웨어 연결이 소멸자를 거치며 정리된다는 것을 [10.9 ros2_control과 hardware_interface](#/ros2-control)에서 실제 아키텍처로 확인한다. 제어 루프 안에서 공유 상태(목표 각도, 센서 최신값)에 접근할 때도 `lock_guard`류의 RAII 락이 기본이다 — 락을 거는 코드와 푸는 코드 사이에 조기 탈출 경로가 하나라도 있으면, 손으로 `unlock()`을 짝짓는 방식은 이 절 1번 예제와 똑같은 사고를 제어 루프 안에서 일으킨다. 1kHz로 도는 루프에서 락이 풀리지 않으면 다음 주기 전체가 멈춘다 — 왜 특히 위험한지는 [6.3](#/mutex)과 [6.8 실시간 제약과 제어 루프](#/realtime)에서 이어서 다룬다.

::: interview RAII가 뭐고 왜 C++에서 중요한가
가장 흔하게 나오는 질문 중 하나다. 답변 뼈대: ① **정의** — Resource Acquisition Is Initialization, 자원의 획득을 생성자에, 해제를 소멸자에 묶는 관용구. ② **왜 필요한가** — C++에는 가비지 컬렉터도 `finally`도 없어서, 해제를 객체 수명에 자동으로 묶지 않으면 매 탈출 경로마다 해제 코드를 손으로 반복해야 한다(`fdleak.cpp`가 그 실패 사례). ③ **핵심 성질** — 정상 반환, 조기 반환, 예외로 인한 스택 되감기 세 경로 전부에서 소멸자가 예외 없이 호출된다(`threepaths.cpp`가 실측으로 증명). ④ **표준 라이브러리의 예** — `lock_guard`, `unique_ptr`, `fstream`, `vector`가 전부 RAII다. ⑤ **한계** — 자원이 스코프 밖(다른 스레드 등)으로 넘어가면 보장이 깨진다. 이 다섯을 실측 근거와 함께 순서대로 말하면 상급 답변이다.
:::

## 요약

- 자원 해제 코드를 함수의 여러 탈출 경로마다 손으로 반복하면 언젠가 하나는 빠뜨린다 — `fdleak.cpp` 실측에서 5번 호출에 정확히 5개의 fd가 새는 것으로 확인했다.
- 정상 반환, 조기 `return`, 예외로 인한 스택 되감기, 이 세 탈출 경로 전부에서 지역 객체의 소멸자가 예외 없이 호출된다(`threepaths.cpp` 실측). RAII는 이 보장 위에 "생성자에서 자원을 얻고 소멸자에서 놓는다"는 규칙 하나만 얹은 것이다.
- 직접 만든 `FileGuard`가 `fdleak.cpp`의 사고를 구조적으로 없앴다. 다만 얕은 복사가 같은 자원을 두 번 해제하게 만든다(`fileguard_doubleclose.cpp`가 `double free`로 실측 확인) — 복사 시맨틱은 RAII와 별개로 설계해야 한다([2.6](#/copy-semantics), [2.8](#/rule-of-five)).
- `lock_guard`, `unique_ptr`, `fstream`, `vector`는 전부 같은 뼈대(생성자에서 획득, 소멸자에서 해제)를 공유하는 표준 RAII 타입이다.
- C++에 `finally`가 없는 이유는 소멸자가 그 역할을 대신하기 때문이다. 예외가 발생해도 스택 되감기 과정에서 자원이 자동으로 해제된다는 것을 수동 관리와의 비교(`exceptsafe.cpp`, LeakSanitizer 실측)로 확인했다.
- RAII는 만능이 아니다. 자원이 스레드 경계를 넘어가거나 소멸자 자체가 실패하는 상황은 별도로 설계해야 한다.

::: quiz 연습문제
1~2번은 개념 문제, 3~5번은 네 컴퓨터에서 직접 확인하는 실습이다.

1. `finally`가 있는 언어와 비교했을 때, RAII가 "해제를 잊는 실수"를 원천적으로 막는 지점이 정확히 어디인지 설명하라. `finally` 블록 자체는 왜 이 실수를 막지 못하는가?

2. 다음 클래스는 왜 위험한가? `FileGuard`와 비교해 무엇이 다른지 설명하라.

   ```cpp
   class BadGuard {
   public:
       BadGuard(const char* path) { fp_ = std::fopen(path, "r"); }
       void close() { std::fclose(fp_); }   // 소멸자가 없다
   private:
       FILE* fp_;
   };
   ```

3. (실습, 코드 작성형) 본문의 `FileGuard`를 직접 타이핑하고, 생성자에서 `fopen`이 실패하는 경로(존재하지 않는 파일 경로를 줘 본다)까지 테스트하라. 성공 기준: 파일이 없을 때 예외가 던져지고, 정상 종료·조기 `return` 두 경로 모두에서 `[FileGuard 소멸]`이 정확히 한 번씩 찍힌다.

4. (실습) `fileguard_doubleclose.cpp`를 그대로 치고 일반 빌드로 한 번, `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address`로 한 번 더 돌려라. 성공 기준: 일반 빌드가 `double free`로 죽는 것과, ASan 빌드가 `attempting double-free` 진단에 두 개의 스택 트레이스(1차 해제, 2차 해제)를 각각 정확히 짚어 보이는 것을 확인했다.

5. (실습, 코드 작성형) `exceptsafe.cpp`의 `manual_version`을 복사해 `manual_version_fixed`라는 이름으로 만들되, `try`/`catch`로 감싸 예외가 나도 `delete a`가 실행되게 고쳐라. 성공 기준: `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address`로 빌드했을 때 `manual_version_fixed`를 호출하는 경로에서는 LeakSanitizer가 아무 것도 보고하지 않는다. 그런 다음 이 수정이 왜 `raii_version`보다 코드가 더 길고 실수하기 쉬운지 한 문장으로 적어라.
:::

::: answer 해설
1. `finally`는 "이 코드를 마지막에 실행하라"는 명령을 프로그래머가 매번 손으로 적어야 한다 — 자원을 여는 코드와 닫는 코드를 짝짓는 책임이 여전히 사람에게 있고, `finally` 블록 자체를 빠뜨리면 언어가 잡아 주지 않는다. RAII는 반대로 "자원을 쥔 객체가 존재하면 언젠가 반드시 소멸하고, 소멸자는 반드시 호출된다"는 언어 차원의 규칙에 기댄다 — 해제 코드를 클래스 안에 한 번만 적어 두면 그 클래스를 쓰는 모든 코드가 자동으로 혜택을 받고, 빠뜨릴 지점 자체가 없다.
2. `BadGuard`는 소멸자가 없고 `close()`라는 일반 멤버 함수만 있다 — 즉 자원 해제가 "누군가 `close()`를 직접 불러 줘야만" 일어난다. `FileGuard`와 정확히 이 절 도입부 `fdleak.cpp`의 `process_bad`와 같은 문제를 그대로 갖고 있다 — 함수가 예외로 빠져나가거나 `close()` 호출 전에 `return`하면 파일이 열린 채로 남는다. 소멸자에 해제를 못박은 `FileGuard`와 달리 `BadGuard`는 RAII가 아니라 이름만 Guard인 평범한 클래스다.
3. 예상 로그: 정상 경로와 조기 `return` 경로 모두 `[FileGuard 생성]` 다음 함수 본문이 실행되고, 함수를 빠져나가기 직전 정확히 `[FileGuard 소멸]`이 한 번 찍힌다. 존재하지 않는 경로를 주면 생성자의 `throw std::runtime_error(...)`가 즉시 던져지고, 이 시점에는 `fp_`가 초기화되지 않았으므로(생성자 본문에서 예외가 나면 그 객체는 애초에 완성되지 않아 소멸자가 불리지 않는다) `[FileGuard 소멸]` 로그가 찍히지 않는 것도 확인해야 한다.
4. 일반 빌드: `free(): double free detected in tcache 2` 뒤 `Aborted (core dumped)`. ASan 빌드: `AddressSanitizer: attempting double-free`가 뜨고, 먼저 소멸한 지역 변수(`b`, 안쪽 스코프 끝)의 스택 트레이스와 나중에 소멸한 `a`(main 끝)의 스택 트레이스가 각각 다른 줄 번호로 찍힌다 — 이 절 본문의 실측과 같은 패턴이다.
5. 수정 예:
   ```cpp
   void manual_version_fixed(bool fail) {
       Resource* a = new Resource(1);
       try {
           if (fail) throw std::runtime_error("중간 실패");
           delete a;
       } catch (...) {
           delete a;
           throw;
       }
   }
   ```
   이렇게 고치면 LeakSanitizer가 조용하다. 하지만 `delete a;`를 정상 경로와 `catch` 양쪽에 두 번 적어야 하고, 예외를 다시 던지는(`throw;`) 코드까지 직접 관리해야 한다 — 자원이 두 개, 세 개로 늘면 이 `try`/`catch` 중첩이 기하급수적으로 복잡해진다. `raii_version`은 `unique_ptr` 하나 선언한 것으로 끝난다 — 이 차이가 RAII를 "귀찮아서 편한 것"이 아니라 "실수의 여지를 구조적으로 없애는 것"으로 만드는 이유다.
:::

이 절의 코드는 전부 직접 쳐라. 특히 `fileguard_doubleclose.cpp`와 `exceptsafe.cpp`는 일반 빌드와 `-fsanitize=address` 빌드를 각각 돌려서 진단 메시지의 차이를 눈으로 봐야 한다. 기준 명령은 `g++ -std=c++20 -Wall -Wextra main.cpp -o main && ./main`, 새니타이저는 `g++ -std=c++20 -Wall -Wextra -g -fsanitize=address main.cpp -o main && ./main`(뮤텍스를 쓰는 `stdraii.cpp`는 `-pthread`를 추가로 붙인다).

**다음 절**: [2.6 복사 시맨틱](#/copy-semantics) — `FileGuard`를 복사했을 때 일어난 이중 해제 사고를 정면으로 연다. 컴파일러가 기본으로 만들어 주는 복사 생성자가 정확히 무엇을 하고, 왜 포인터를 멤버로 가진 클래스에서 그 기본값이 위험한지부터 시작한다.

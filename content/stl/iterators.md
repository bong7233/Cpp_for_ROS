# 5.4 반복자와 무효화 규칙

::: lead
[5.1](#/vector)은 `push_back` 한 번이 재할당을 부르면 그 순간 기존 포인터·반복자가 전부 무효화된다는 걸 ASan으로 보여줬고, [5.3](#/seq-containers)은 `deque`가 양끝 삽입에도 레퍼런스를 지켜낸다는 것과 `list`는 삽입/삭제해도 다른 반복자는 안전하다는 것을 예고만 해 뒀다. 이 절은 그 예고를 전 컨테이너를 관통하는 표 하나로 정리한다. 하지만 표보다 먼저 봐야 할 문제가 있다 — "컨테이너를 순회하면서 그 컨테이너를 고치는" 코드는 사실상 모든 C++ 개발자가 한 번은 짜고, 한 번은 틀린다. `erase`가 반환하는 값을 무시하고 원래 쓰던 반복자로 계속 `++`를 하면 무슨 일이 나는지 직접 실행해서 확인한다. 그 뿌리를 이해하려면 반복자 카테고리부터, `std::advance`가 카테고리에 따라 완전히 다른 코드를 태운다는 사실부터 봐야 한다.
:::

## 반복자 카테고리: 다섯 계층

반복자는 전부 같은 인터페이스(`*it`, `++it`)를 흉내 내지만, 실제로 할 수 있는 연산의 범위는 컨테이너마다 다르다. C++20은 이 능력을 다섯 단계 계층으로 정의하고, 상위 카테고리는 하위 카테고리의 연산을 전부 포함한다.

| 카테고리 | 추가로 되는 연산 | 못 하는 것(하위 카테고리 대비) |
|---|---|---|
| input | `*it`(읽기 전용), `++it`, `it != end` | 되감기(`--`) 불가, 한 번 지나간 자리는 다시 못 감 |
| forward | input + 여러 번 반복 순회 가능 | `--it` 불가 |
| bidirectional | forward + `--it`(뒤로 한 칸) | `it + n`, `it[n]` 같은 산술 불가 |
| random-access | bidirectional + `it + n`, `it - n`, `it[n]`, `<`/`>` 비교 | (최상위 — 전부 가능) |

이 절이 다루는 컨테이너는 다음 카테고리로 갈린다 — 실제로 `<iterator>`의 concept(`std::random_access_iterator` 등)로 검사한 결과다.

```cpp title="category_check.cpp -- 각 컨테이너 반복자가 만족하는 concept을 컴파일 타임에 확인"
#include <iterator>
#include <vector>
#include <deque>
#include <list>
#include <forward_list>
#include <map>
#include <unordered_map>
#include <array>

template <typename It>
std::string classify() {
    if constexpr (std::random_access_iterator<It>)      return "random_access";
    else if constexpr (std::bidirectional_iterator<It>)  return "bidirectional";
    else if constexpr (std::forward_iterator<It>)        return "forward";
    else if constexpr (std::input_iterator<It>)          return "input";
    else                                                  return "(해당 없음)";
}
// vector, deque, array, list, forward_list, map, unordered_map 각각의
// ::iterator 타입을 classify<>()에 넣어 결과를 출력한다
```

```console
$ g++ -std=c++20 -Wall -Wextra category_check.cpp -o category_check
$ ./category_check
vector<int>::iterator          -> random_access
deque<int>::iterator            -> random_access
array<int,4>::iterator          -> random_access
list<int>::iterator             -> bidirectional
forward_list<int>::iterator     -> forward
map<int,int>::iterator          -> bidirectional
unordered_map<int,int>::iterator-> forward
```

(g++ 13.3 / libstdc++ 실측.) `vector`·`deque`·`array`는 연속이든 청크든 "인덱스로 몇 칸을 건너뛸 자리를 계산할 수 있는" 구조라 random-access다. `list`·`map`·`set`은 노드끼리 포인터로 엮여 있어서 한 칸씩만 갈 수 있지만, 양쪽 링크(`prev`/`next`, 트리의 부모/자식)가 있어 되감기(`--`)는 된다 — bidirectional. `unordered_map`은 버킷 안에서 한 방향으로만 체이닝된 연결 리스트라 forward에서 멈춘다. `forward_list`(단일 연결 리스트)는 뒤로 갈 방법 자체가 없어서 `size()`조차 제공하지 않는다.

::: note 카테고리는 "얼마나 잘 만들었나"가 아니라 "구조가 뭘 허용하나"다
`vector`가 random-access라서 `list`보다 우월한 게 아니다 — [5.3](#/seq-containers)에서 본 것처럼 중간 삽입/삭제는 `list`가 압도적으로 싸다. 카테고리는 그 자료구조의 물리적 배치가 어떤 이동 연산을 상수 시간에 지원하는지를 반영할 뿐이다.
:::

## std::advance/std::distance는 카테고리에 따라 다른 코드를 태운다

`std::advance(it, n)`과 `std::distance(first, last)`는 모든 반복자 카테고리에 똑같이 호출할 수 있는 자유 함수다. 하지만 컴파일러가 실제로 만들어내는 코드는 카테고리에 따라 완전히 다르다 — 컴파일 타임에 카테고리 태그로 오버로드가 갈리기 때문이다. random-access면 `it += n`(포인터 산술 한 번)으로 끝내고, 그 아래 카테고리면 `++it`(또는 `--it`)를 `n`번 반복한다. 이걸 눈으로 믿지 말고, `operator++`와 `operator+=` 각각이 실제로 몇 번 불리는지 세는 반복자로 감싸서 확인한다.

```cpp title="category_advance.cpp -- operator++/operator+= 호출 횟수를 직접 센다"
template <typename Base>
struct CountingIter {
    using iterator_category = typename std::iterator_traits<Base>::iterator_category;
    // ... value_type, difference_type, pointer, reference도 Base에서 그대로 가져온다
    Base it;
    static inline long step_calls = 0;  // operator++ / operator-- 호출 횟수
    static inline long jump_calls = 0;  // operator+= 호출 횟수 (한 번에 n칸)

    CountingIter& operator++() { ++it; ++step_calls; return *this; }
    CountingIter& operator--() { --it; ++step_calls; return *this; }
    CountingIter& operator+=(std::ptrdiff_t n) { it += n; ++jump_calls; return *this; }
    // operator*, operator-, operator==/!= 는 it에 그대로 위임한다
};

// vector<int>(100000개)와 list<int>(100000개) 각각을
// CountingIter로 감싸 std::advance(it, 50000), std::distance(begin, end)를 호출한다
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 category_advance.cpp -o category_advance
$ ./category_advance
[vector] std::advance(N/2)  -> operator++ 호출 0회, operator+= 호출 1회
[list]   std::advance(N/2)  -> operator++ 호출 50000회, operator+= 호출 0회
[vector] std::distance()   -> 결과=100000  operator++ 호출 0회
[list]   std::distance()   -> 결과=100000  operator++ 호출 100000회
```

(g++ 13.3 / `-O2` 실측.) `vector`는 `std::advance`가 `operator+=`를 **딱 한 번** 부르고 끝났다 — 카테고리가 random-access라서 오버로드 자체가 산술 버전으로 골라진 것이다. `list`는 `operator++`를 **정확히 5만 번** 불렀다 — bidirectional까지만 되니 한 칸씩 세는 것 외에 방법이 없다. `std::distance`도 마찬가지다 — `vector`는 `end - begin` 뺄셈 한 번, `list`는 원소 10만 개를 전부 세야 한다. 이 실측을 실제 벽시계 시간으로 재확인하면 차이는 더 극명하다.

```console
$ g++ -std=c++20 -Wall -Wextra -O2 advance_timing.cpp -o advance_timing
$ ./advance_timing
N=200000  vector::advance(N/2)=115 ns   list::advance(N/2)=583744 ns
N=400000  vector::advance(N/2)=48 ns    list::advance(N/2)=1.07912e+06 ns
```

(g++ 13.3 / `-O2` 실측, `sink = *it;`로 결과를 실제로 읽어 `advance` 자체가 죽은 코드로 지워지지 않게 막았다 — [8.6 마이크로벤치마크의 함정](#/benchmarking)에서 다룰 문제 그대로다.) `vector`는 `N`이 두 배(20만→40만)가 돼도 advance 시간이 그대로(수십~백여 나노초, 오차 범위)다 — $O(1)$의 정의 그 자체다. `list`는 `N`이 두 배가 되자 advance 시간도 약 두 배(58만→108만 나노초)로 늘었다 — $O(n)$이다. 임의 위치로 건너뛰는 코드를 `list`나 `map`에 무심코 쓰면, `advance`/`distance` 호출 하나가 컨테이너 크기에 비례해 느려지는 걸 모르고 지나치기 쉽다.

::: interview "std::advance는 항상 O(1)인가"
자주 나오는 함정 질문이다. 답변 뼈대: ① 아니다 — 반복자 카테고리에 따라 서로 다른 오버로드로 컴파일 타임 디스패치된다. ② random-access(`vector`, `deque`, `array`)는 산술 한 번으로 끝나 $O(1)$이다. ③ bidirectional 이하(`list`, `map`, `set`)는 `++`/`--`를 반복하는 수밖에 없어 $O(n)$이다(실측: `operator++`가 정확히 요청한 칸 수만큼 불렸다). ④ 그래서 실제 비용은 컨테이너 종류를 알아야만 예측할 수 있다.
:::

## 범위 기반 for의 실체: begin()/end()는 몇 번 불리는가

`for (int x : container)`는 컴파일러가 아래 형태로 그대로 풀어 쓰는 문법 설탕이다.

```text nolines
auto&& __range = container;
auto __it  = __range.begin();     // 딱 한 번만 호출된다
auto __end = __range.end();       // 이것도 딱 한 번만 호출된다
for ( ; __it != __end; ++__it) {
    int x = *__it;
    // 루프 본문
}
```

"매 반복마다 `end()`를 다시 계산해서 확인하는 것 아닌가"는 흔한 오해다. `__end`는 루프 시작 시점에 **딱 한 번** 저장되고, 그 뒤로는 저장해 둔 값과 비교만 한다. `begin()`/`end()`를 호출할 때마다 로그를 찍는 래퍼로 직접 확인한다.

```cpp title="range_for_desugar.cpp -- begin()/end() 호출 횟수를 직접 센다"
struct LoggingVec {
    std::vector<int> data{1,2,3,4,5};
    auto begin() { std::cout << "  [begin() 호출]\n"; return data.begin(); }
    auto end()   { std::cout << "  [end() 호출]\n";   return data.end(); }
};
// for (int x : LoggingVec{}) { ... } 를 실행하고 로그 순서를 본다
```

```console
$ g++ -std=c++20 -Wall -Wextra range_for_desugar.cpp -o range_for_desugar
$ ./range_for_desugar
범위 기반 for 시작
  [begin() 호출]
  [end() 호출]
원소=1
원소=2
원소=3
원소=4
원소=5
범위 기반 for 끝
```

(g++ 13.3 실측.) `begin()`/`end()`는 각각 정확히 한 번씩만 찍혔다 — 원소가 5개인데도 5번이 아니다. 이 사실은 뒤에서 다룰 "흔한 실수"와 직결된다. **루프가 시작될 때 이미 `__end`가 그 순간의 컨테이너 크기로 고정돼 버린다면, 루프 본문에서 컨테이너 크기를 바꾸는 순간 `__end`는 더 이상 진짜 끝을 가리키지 않는다.** 범위 기반 for 안에서 `erase`/`insert`를 하면 안 되는 이유의 절반이 여기 있다 — 나머지 절반은 원소 자체의 무효화다.

## 컨테이너별 무효화 규칙표

"삽입/삭제가 반복자·포인터·레퍼런스를 무효화하는가"는 컨테이너의 메모리 구조([5.1](#/vector), [5.3](#/seq-containers))에서 그대로 따라 나온다. 표로 정리한다 — **모든 컨테이너에 공통으로, 지운 원소 자체를 가리키던 반복자/포인터/레퍼런스는 항상 무효화된다**는 것부터 전제로 깔고, "다른 원소"에 대한 영향만 비교한다.

| 컨테이너 | 삽입 | 삭제(erase) | 비고 |
|---|---|---|---|
| `vector` | 재할당 있으면 **전부** 무효화. 재할당 없으면 삽입 지점 **이전은 안전**, **이후는 무효화**(주소는 살아있지만 다른 원소를 가리키게 됨) | 삭제 지점부터 `end()`까지 전부 무효화(뒤 원소가 앞으로 당겨진다) | [5.1](#/vector) |
| `deque` | 중간 삽입은 **전부** 무효화(표준 규정). 양끝(`push_front`/`push_back`)은 **반복자만** 무효화되고 포인터·레퍼런스는 유지 | 중간 삭제는 전부 무효화. 양끝 삭제는 그 원소 자체만 | [5.3](#/seq-containers) |
| `list` | 삽입은 **다른 어떤 반복자·포인터·레퍼런스도 무효화하지 않는다**(노드를 새로 잇기만 함) | **지워진 노드의 반복자만** 무효화, 나머지는 전부 안전 | 노드 기반 — 원소가 이동하지 않는다 |
| `map`/`set` | 삽입은 다른 반복자를 무효화하지 않는다(트리 노드 추가만) | **지워진 노드의 반복자만** 무효화, 나머지는 전부 안전 | `list`와 동일한 이유(노드 기반) |
| `unordered_map`/`unordered_set` | 삽입이 재해시([5.2](#/assoc-containers))를 부르면 **모든 반복자**가 무효화(단, 포인터·레퍼런스는 노드 기반이라 재해시에도 유지) | `map`과 동일 — 지워진 원소의 반복자만 | 재해시 여부가 관건 |

`list`/`map`/`set`이 "노드 기반"이라 삽입·삭제에 강한 이유는 단순하다 — 원소 하나하나가 힙의 독립된 블록이고, 삽입/삭제는 그 블록들을 잇는 포인터만 바꾼다([5.3](#/seq-containers)의 이중 연결 리스트 그림 그대로다). 원소 자체가 새 자리로 복사·이동될 일이 없으니, 그 원소를 가리키던 반복자도 값이 그대로 안전하다. 반대로 `vector`·`deque`는 원소가 (적어도 부분적으로) 연속된 슬롯에 놓이므로, 슬롯 사이에 뭔가 끼워 넣거나 빼면 다른 원소들이 물리적으로 밀린다.

## vector: 무효화가 "크래시"가 아니라 "조용히 다른 값"일 때

[5.1](#/vector)에서 재할당이 일으키는 무효화는 ASan이 바로 `heap-use-after-free`로 잡아 줬다 — 옛 버퍼 자체가 `delete[]`됐기 때문이다. 하지만 표의 "재할당 없으면 삽입 지점 이후만 무효화"는 다른 종류의 문제다. 재할당이 없으면 버퍼는 그대로 살아있으니 ASan이 잡을 메모리 에러 자체가 없다 — **주소는 멀쩡한데, 그 주소가 담고 있는 값이 원래 가리키던 원소가 아니게 된다.** 이게 "무효화됐다"는 말의 더 위험한 절반이다: 크래시하지 않으니 버그인 줄 모르고 넘어간다.

```cpp title="vector_partial_invalidate.cpp -- 재할당 없는 insert의 부분 무효화"
std::vector<int> v{10, 20, 30, 40, 50};
v.reserve(20);              // 여유를 넉넉히 둬서 이 insert가 재할당을 안 하게 만든다

int* p_before = &v[0];      // 삽입 지점(인덱스 2)보다 앞
int* p_after  = &v[3];      // 삽입 지점보다 뒤

v.insert(v.begin() + 2, 99);   // capacity 여유가 있어 재할당 없음
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g vector_partial_invalidate.cpp -o vpi
$ ./vpi
삽입 후 v = 10 20 99 30 40 50
p_before 역참조 = 10 (기대값 10, 삽입 지점 이전이라 안전)
p_after  역참조 = 30 (원래 담겼던 40이 아니라 다른 값 -- 주소는 살아있지만 다른 원소를 가리킨다)
```

(g++ 13.3 / ASan 실측 — ASan이 아무 에러도 안 낸다는 것 자체가 이 실측의 핵심이다.) `p_before`는 삽입 지점 앞이라 그 값(10)이 그대로 안전했다. `p_after`는 삽입 전엔 40을 가리켰는데, 삽입 후 같은 주소를 읽으니 **30**이 나왔다 — 뒤로 밀린 원소들이 그 물리적 슬롯을 덮어썼기 때문이다. `p_after`는 여전히 "유효한, 할당된 메모리"를 가리키고 있어서 역참조해도 죽지 않는다. 표준이 이걸 "무효화"라고 부르는 이유는 메모리 안전성이 아니라 **의미론적 안전성**이다 — 당신이 40을 가리킨다고 믿고 들고 있던 포인터가 이제 40이 아닌 값을 준다.

::: danger ASan이 조용하다고 코드가 옳은 게 아니다
새니타이저는 **메모리 안전성**(해제된 메모리 읽기, 범위 밖 접근)만 잡는다. 위 예제처럼 "여전히 할당된 메모리를 읽지만 논리적으로 다른 원소"인 경우는 ASan/UBSan 어느 쪽도 잡지 못한다 — 프로그램이 완주하고 값도 출력되니 겉보기엔 멀쩡하다. `vector`·`deque`의 부분 무효화 규칙을 표로 외워 둬야 하는 이유가 정확히 여기 있다: 도구가 대신 잡아주지 않는 버그 종류이기 때문이다.
:::

## deque: 중간 삽입이 전부를 무효화한다는 것의 실체

[5.3](#/seq-containers)에서 `deque`는 청크(chunk) 단위로 원소를 나눠 담고, 중간에 끼워 넣을 때는 삽입 지점 앞뒤 중 **원소 수가 적은 쪽만** 물리적으로 옮긴다고 했다. 그 말은 곧 "표준은 전부 무효화라고 선언하지만, 실제로 옮겨지지 않은 쪽은 이 구현에서 우연히 안전하다"는 뜻이다. 밀리는 쪽과 안 밀리는 쪽을 각각 포인터로 잡아서 확인한다.

```cpp title="deque_mid_insert.cpp -- 밀리는 쪽과 안 밀리는 쪽을 대조한다"
std::deque<int> d{0,1,2,3,4,5,6};   // 삽입 지점(인덱스2)에서 앞쪽(2개)이 뒤쪽(5개)보다 싸다

int* p_front_side = &d[1];   // 밀리는 쪽(앞)
int* p_back_side  = &d[5];   // 밀리지 않는 쪽(뒤)

d.insert(d.begin() + 2, 99);
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g deque_mid_insert.cpp -o dmi
$ ./dmi
삽입 후 d = 0 1 99 2 3 4 5 6
p_front_side(밀리는 쪽) 역참조 = 99 (원래 담겼던 1이 그대로인지 확인)
p_back_side(안 밀리는 쪽)  역참조 = 5 (기대값 5, 뒤쪽은 안 옮겨졌으니 안전해야 한다)
```

(g++ 13.3 / libstdc++ 실측.) `p_front_side`는 원래 1을 가리켰는데 삽입 후 같은 주소를 읽으니 **99**(새로 끼워 넣은 값)가 나왔다 — 앞쪽이 뒤로 밀리면서 그 슬롯을 새 원소가 차지했다. `p_back_side`는 여전히 5를 가리켰다 — 뒤쪽은 이번 구현에서 안 옮겨졌기 때문이다. 하지만 표준은 이 "안 옮겨진 쪽"에 대해서도 아무 보장을 하지 않는다 — libstdc++가 "더 싼 쪽을 옮긴다"는 최적화를 이렇게 구현했을 뿐, **`deque`의 중간 삽입 앞에서는 항상 표에 적힌 대로 "전부 무효화됐다"고 가정하고 코드를 짜야 한다.** 반대로 양끝 삽입은 표준이 직접 보장하는 안전이라 안심하고 써도 된다.

```console
$ ./deque_invalidation
[deque] push_front/push_back 이후 기존 포인터 역참조 = 3 (기대값 3)
```

(g++ 13.3 실측.) `push_front`/`push_back`을 두 번 해도 중간 원소를 가리키던 포인터는 멀쩡했다 — [5.3](#/seq-containers)의 "청크 안 원소는 절대 옮기지 않는다"는 구조가 정확히 이 안전을 만든다.

## list, map, set: 지워진 원소의 반복자만 무효화된다

노드 기반 컨테이너의 강점을 정직하게 보여준다 — 삭제된 노드가 아닌 다른 어떤 반복자도 안전하다.

```cpp title="list_map_erase_safe.cpp -- 삭제된 원소 이외의 반복자는 안전하다"
std::list<int> l{10, 20, 30, 40, 50};
auto it_keep = std::next(l.begin(), 3);   // 40을 가리키는 반복자
auto it_drop = std::next(l.begin(), 1);   // 20을 가리키는 반복자 -- 이걸 지운다
l.erase(it_drop);                          // 20만 지운다

std::map<std::string, int> m{{"a",1}, {"b",2}, {"c",3}, {"d",4}};
auto mit_keep = m.find("c");
auto mit_drop = m.find("b");
m.erase(mit_drop);                         // "b"만 지운다
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g list_map_erase_safe.cpp -o lmes
$ ./lmes
[list] it_drop으로 지운 뒤 it_keep 역참조 = 40 (기대값 40)
[map]  mit_drop으로 지운 뒤 mit_keep 역참조 = c->3 (기대값 c->3)
```

`l.erase(it_drop)`이 실제로 하는 일은 20을 담은 노드의 앞뒤 노드끼리 `prev`/`next`를 다시 이어 붙이고 그 노드를 `delete`하는 것뿐이다 — 40을 담은 노드는 건드릴 이유가 없다. `map`도 트리에서 노드 하나를 떼어내고 부모·자식 관계만 재조정한다. 반대로, **지워진 그 노드를 가리키던 반복자 자체**를 계속 쓰면 여전히 위험하다 — 노드가 `delete`됐으니 이번엔 ASan이 정확히 잡는다.

```cpp title="list_erase_dangle.cpp -- 지워진 노드 자체를 가리키던 반복자는 여전히 위험하다"
std::list<int> l{10, 20, 30, 40, 50};
auto it_drop = std::next(l.begin(), 1);   // 20을 가리킨다
l.erase(it_drop);          // 20이 든 노드를 delete한다
std::cout << *it_drop;     // 이미 delete된 노드를 역참조
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g list_erase_dangle.cpp -o led
$ ./led
==31009==ERROR: AddressSanitizer: heap-use-after-free on address 0x503000000080
READ of size 4 at 0x503000000080 thread T0
    #0 ... in main list_erase_dangle.cpp:11
freed by thread T0 here:
    ...
    #5 ... in std::__cxx11::list<int, std::allocator<int> >::_M_erase(...) /usr/include/c++/13/bits/stl_list.h:2024
SUMMARY: AddressSanitizer: heap-use-after-free ... in main
```

(g++ 13.3 / ASan 실측 — 스택 트레이스는 핵심만 남겼다.) "지워진 원소만 무효화된다"는 말은 **"다른 원소는 안전하다"는 뜻이지 "지워진 원소를 가리키던 그 반복자를 계속 써도 된다"는 뜻이 아니다.** 둘을 헷갈리면 이 절 표 전체를 잘못 읽은 것이다.

## 흔한 실수: 순회하면서 그 컨테이너를 고친다

앞선 모든 실측을 하나로 합치면 실전에서 매일 나오는 버그가 설명된다 — **3의 배수를 지우면서 `vector`를 순회하는 코드**다. 틀린 버전부터 실행해서 실제로 무슨 일이 나는지 본다.

```cpp title="erase_wrong.cpp -- erase의 반환값을 버리는 흔한 실수"
std::vector<int> v{1,2,3,4,5,6,7,8,9,10,11,12};
v.reserve(30);   // 재할당 여부와 무관하게 문제가 생긴다는 걸 보이려고 여유를 둔다

for (auto it = v.begin(); it != v.end(); ++it) {
    if (*it % 3 == 0) {
        v.erase(it);   // ❌ 반환값을 버린다 -- it는 이 순간 무효화됐다
    }
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 erase_wrong.cpp -o erase_wrong
$ ./erase_wrong
Segmentation fault (core dumped)

$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g erase_wrong.cpp -o erase_wrong_asan
$ ./erase_wrong_asan
==28087==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x50c0000000b8
READ of size 4 at 0x50c0000000b8 thread T0
    #0 ... in main erase_wrong.cpp:10
0x50c0000000b8 is located 0 bytes after 120-byte region [0x50c000000040,0x50c0000000b8)
SUMMARY: AddressSanitizer: heap-buffer-overflow ... in main
```

(g++ 13.3 실측 — 최적화 빌드는 세그폴트로, ASan 빌드는 `heap-buffer-overflow`로 각각 죽었다.) `erase(it)`는 삭제 지점부터 `end()`까지의 원소를 한 칸씩 당기고 새 `end()`를 돌려주는데, 원래 `it`는 그 갱신을 반영하지 못한 채 그대로다. 루프가 이 무효화된 `it`에 계속 `++it`를 적용하면서 `it`가 가리키는 물리적 위치와 컨테이너의 실제 크기 사이의 관계가 어긋나고, 결국 `reserve(30)`으로 확보한 120바이트(원소 30개) 버퍼 전체를 벗어나는 지점에서 ASan이 `heap-buffer-overflow`로 잡았다.

올바른 관용구는 **`erase`가 돌려주는 반복자를 그 자리에서 다시 받아 쓰는 것**이다.

```cpp title="erase_right.cpp -- erase의 반환값을 it에 다시 대입한다"
for (auto it = v.begin(); it != v.end(); ) {
    if (*it % 3 == 0) {
        it = v.erase(it);   // ✅ 다음 원소를 가리키는, 유효한 반복자를 받는다
    } else {
        ++it;
    }
}
```

```console
$ g++ -std=c++20 -Wall -Wextra -fsanitize=address -g erase_right.cpp -o erase_right
$ ./erase_right
결과: 1 2 4 5 7 8 10 11
```

(g++ 13.3 / ASan 실측 — 에러 없이 3의 배수가 정확히 지워졌다.) 두 버전의 유일한 차이는 조건이 맞을 때 `++it`를 부르느냐, `it = v.erase(it)`를 부르느냐다. `erase`는 삭제 지점 이후 원소를 당긴 뒤 그 당겨진 자리를 가리키는 새 반복자를 계산해서 돌려준다 — 이 값을 받아 쓰면 `it`가 항상 컨테이너의 현재 상태와 일치한다. `list`·`map`·`set`도 무효화 규칙은 다르지만 "erase의 반환값을 받아쓴다"는 관용구는 전부 동일하게 안전하다.

## C++20: std::erase / std::erase_if로 관용구 하나로 통일

C++20 이전에는 컨테이너마다 지우는 방법이 미묘하게 달랐다 — `vector`/`deque`/`string`은 "erase-remove" 관용구(`v.erase(std::remove(v.begin(), v.end(), x), v.end())`, [5.5](#/algorithms)에서 다룬다)를 써야 했고, `list`/`map`/`set`은 멤버 함수 `remove`/`remove_if`가 따로 있었다. C++20은 이 차이를 자유 함수 `std::erase`(값으로 지움)/`std::erase_if`(조건으로 지움) 하나로 통일했다.

```cpp title="erase_if_demo.cpp -- 컨테이너 종류와 무관하게 똑같은 호출"
auto n = std::erase_if(v, [](int x) { return x % 3 == 0; });   // vector
std::erase_if(l, [](int x) { return x % 3 == 0; });             // list, 반환값 없음
std::erase_if(m, [](const auto& kv) { return kv.second % 2 == 0; }); // map
auto n2 = std::erase(v2, 2);   // 값 2를 전부 지운다
```

```console
$ g++ -std=c++20 -Wall -Wextra -O2 erase_if_demo.cpp -o erase_if_demo
$ ./erase_if_demo
[vector] erase_if 결과: 1 2 4 5 7 8 10 11  (지운 개수=4)
[list]   erase_if 결과: 1 2 4 5 7 8 10 11
[map]    erase_if 결과: a=1 c=3
[vector] erase(v2, 2) 결과: 1 3 4  (지운 개수=3)
```

(g++ 13.3 실측.) `std::erase_if`의 반환값(`vector`의 경우 4)은 지운 원소 개수다. 내부적으로 `vector`/`deque`/`string`은 여전히 erase-remove를, `list`는 멤버 `remove_if`를, `map`/`set`은 순회하며 조건에 맞는 것만 골라 `erase`를 호출한다 — **관용구는 통일됐지만 내부 알고리즘은 이 절의 무효화 규칙을 그대로 따른다.** "조건에 맞는 원소를 지운다"는 목적이면 직접 루프를 짜기 전에 `std::erase_if`부터 떠올려라.

## 로보틱스 도메인: 센서 이상치 제거에서 실제로 나는 버그

IMU나 라이다에서 들어온 샘플 버퍼를 순회하며 범위를 벗어난 이상치를 골라 지우는 코드는 정확히 이 절의 "흔한 실수" 패턴이 나오는 자리다. `std::vector<double> readings`를 순회하다 `abs(readings[i]) > threshold`인 값을 `erase`로 지우면서 반환값을 받지 않으면, 뒤쪽 이상치 몇 개를 건너뛰거나 최악의 경우 버퍼 밖을 읽는다. 문제는 이게 항상 크래시로 끝나지 않는다는 것이다 — 이상치 위치에 따라 그냥 "몇 개를 놓친 채로 필터가 조용히 끝나는" 결과가 나올 수 있고, 크래시 로그가 없으니 발견이 훨씬 늦다. `std::erase_if(readings, [threshold](double x){ return std::abs(x) > threshold; })` 한 줄로 바꾸면 이 규칙을 전부 신경 쓸 필요 없이 안전하게 끝난다.

## 요약

- 반복자는 다섯 카테고리(input/forward/bidirectional/random-access, output은 별개 계층)로 나뉘고, 상위는 하위 연산을 포함한다 — `vector`/`deque`/`array`는 random-access, `list`/`map`/`set`은 bidirectional, `unordered_map`/`forward_list`는 forward다(실측: C++20 concept로 확인).
- `std::advance`/`std::distance`는 카테고리에 따라 다른 코드를 컴파일한다 — random-access는 산술 한 번(`operator+=` 1회)으로 끝나고, 그 아래는 `operator++`를 요청한 칸 수만큼 반복한다(실측: `list`에서 5만 번 호출, 실제 시간도 `N`에 비례해 늘어남).
- 범위 기반 for는 `begin()`/`end()`를 루프 시작 시 **딱 한 번**만 호출한다(실측). 루프 안에서 컨테이너 크기를 바꾸면 미리 저장된 `end()`가 더는 진짜 끝이 아니게 된다.
- 무효화 규칙은 컨테이너의 메모리 구조를 그대로 반영한다 — `vector`(재할당 시 전부, 아니면 삽입 지점 이후만), `deque`(중간 삽입은 전부, 양끝은 반복자만), `list`/`map`/`set`(지워진 노드의 반복자만, 나머지는 전부 안전).
- 무효화가 항상 크래시로 나타나는 건 아니다 — 재할당 없는 `vector::insert`는 삽입 지점 이후 포인터를 "여전히 유효한 메모리, 다른 값"으로 바꿔 버린다(실측: ASan 침묵, 값만 40→30으로 바뀜). 새니타이저는 이런 의미론적 버그를 못 잡는다.
- 순회 중 `erase`의 반환값을 버리는 실수는 실제로 세그폴트/`heap-buffer-overflow`를 낸다(실측). `it = c.erase(it);` 관용구로 고치면 사라진다. C++20 `std::erase`/`std::erase_if`는 이 관용구 자체를 표준 라이브러리 안으로 흡수했다.

::: quiz 연습문제
1~3번은 개념 문제, 4~5번은 네 컴퓨터에서 직접 코드를 짜고 실행해서 확인하는 실습이다.

1. `list<int>::iterator`와 `vector<int>::iterator`가 각각 만족하는 반복자 카테고리를 밝히고, `std::advance(it, 1000)`을 불렀을 때 내부적으로 어떤 연산이 몇 번 일어나는지 각각 설명하라.
2. 표에서 `vector`의 삽입 규칙("재할당 있으면 전부, 없으면 삽입 지점 이후만")과 `deque`의 삽입 규칙("중간은 전부, 양끝은 반복자만")의 차이를 각 컨테이너의 메모리 구조로 설명하라.
3. (예측) `erase_wrong.cpp`를 `list`로 바꿔서 짜면(즉 `std::list`를 순회하며 `l.erase(it); ++it;`를 그대로 쓰면) 이 절의 `vector` 버전과 같은 세그폴트가 날지, 아니면 다른 증상이 날지 예측하고 근거를 써라(힌트: `list::erase`가 반환하지 않은 반복자 자체를 무효화하는 방식과, `vector`가 원소를 물리적으로 당기는 방식의 차이).
4. (실습, 코드 작성형) `vector_partial_invalidate.cpp`를 그대로 타이핑하고, 삽입 위치를 `v.begin() + 2`에서 `v.begin() + 4`(맨 끝)로 바꿔 실행하라. 성공 기준: `p_after`(인덱스 3을 가리키던 포인터)가 이번에는 무효화되지 않고 원래 값(40)을 그대로 돌려주는 것을 확인하고, 왜 그런지 이 절의 규칙("삽입 지점 이후만 무효화")으로 설명한다.
5. (실습) `erase_wrong.cpp`와 `erase_right.cpp`를 둘 다 그대로 타이핑하고, 각각 `-fsanitize=address -g`를 붙여 실행하라. 성공 기준: 틀린 버전은 ASan 에러(또는 세그폴트)로 죽고, 올바른 버전은 에러 없이 `1 2 4 5 7 8 10 11`을 정확히 출력하는 것을 네 눈으로 확인했다.
:::

::: answer 해설
1. `vector<int>::iterator`는 random-access다 — `std::advance(it, 1000)`은 `it += 1000` 한 번(포인터 산술)으로 끝난다. `list<int>::iterator`는 bidirectional이라 `it += 1000` 같은 연산 자체가 없고, `++it`를 정확히 1000번 반복한다 — 이 절의 실측이 그 호출 횟수 차이를 직접 보여줬다.
2. `vector`는 원소가 하나의 연속 버퍼에 있다. 재할당이 일어나면 버퍼 자체가 통째로 새 자리로 옮겨가니 옛 버퍼를 가리키던 모든 것이 무효화되고, 재할당이 없으면 버퍼는 그대로지만 삽입 지점 이후 원소들만 물리적으로 밀리므로 그 위치를 가리키던 것만 무효화된다. `deque`는 양끝에 넣을 때는 새 청크만 추가해 기존 원소를 안 옮기지만(그래서 반복자만 무효화), 중간에 넣을 때는 앞뒤 중 한쪽 청크군 전체를 옮겨야 해서 표준은 안전하게 전부 무효화로 규정한다.
3. `list`에서 같은 실수를 하면 `vector`와 다른 증상이 난다 — `list::erase`는 삭제된 노드를 즉시 `delete`하므로, 무효화된 `it`에 `++it`를 하는 순간 이미 해제된 메모리에서 `next`를 읽는 `heap-use-after-free`가 된다(`list_erase_dangle.cpp`가 이 상황이다). `vector`는 메모리를 즉시 해제하지 않고 원소만 밀기 때문에 처음엔 "조용히 다른 원소를 가리키는" 정도로 넘어가다가 결국 범위를 벗어나 `heap-buffer-overflow`로 죽는다.
4. 삽입 위치를 맨 끝(`v.begin() + 4`, 인덱스4 앞)으로 옮기면 `p_after`(인덱스3, `&v[3]`)는 이제 삽입 지점보다 **앞**이 된다. 이 절의 규칙("삽입 지점 이전은 안전")대로 `p_after`는 무효화되지 않고 원래 값 40을 그대로 돌려줘야 한다 — "무효화 여부는 삽입 지점과의 상대적 위치로 결정된다"는 걸 직접 확인하는 문제다.
5. `erase_wrong.cpp`는 ASan 빌드에서 `heap-buffer-overflow`(또는 최적화 빌드에서 세그폴트)로 죽고, `erase_right.cpp`는 어떤 빌드에서도 에러 없이 `1 2 4 5 7 8 10 11`을 정확히 출력해야 한다. 다른 결과가 나온다면 `erase`의 반환값을 받아 쓰는 위치나 조건문이 이 절의 코드와 다르게 짜여 있을 가능성이 크다.
:::

이 절의 `category_check.cpp`, `category_advance.cpp`, `advance_timing.cpp`, `range_for_desugar.cpp`, `vector_partial_invalidate.cpp`, `deque_mid_insert.cpp`, `list_map_erase_safe.cpp`, `list_erase_dangle.cpp`, `erase_wrong.cpp`, `erase_right.cpp`, `erase_if_demo.cpp`를 전부 직접 타이핑해라. 특히 `erase_wrong.cpp`/`erase_right.cpp` 쌍은 반드시 `-fsanitize=address -g`로 돌려서 하나는 죽고 하나는 안 죽는 걸 두 눈으로 봐라. 기준 명령: `g++ -std=c++20 -Wall -Wextra -O2 파일.cpp -o 이름 && ./이름`.

**다음 절**: [5.5 &lt;algorithm&gt; 완전 정복](#/algorithms) — 이 절에서 예고한 erase-remove 관용구가 정확히 무엇이고, `std::sort`·`std::find`·`std::transform` 같은 알고리즘이 반복자 카테고리에 따라 어떻게 알고리즘 자체를 바꾸는지(예: `sort`는 random-access가 필요하다) 이어서 다룬다.

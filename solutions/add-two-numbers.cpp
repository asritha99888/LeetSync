/**
 * Definition for singly-linked list.
 * struct ListNode {
 *     int val;
 *     ListNode *next;
 *     ListNode() : val(0), next(nullptr) {}
 *     ListNode(int x) : val(x), next(nullptr) {}
 *     ListNode(int x, ListNode *next) : val(x), next(next) {}
 * };
 */
class Solution {
public:
    // Fixed padding function: targets the actual end of the list directly
    ListNode* push_back(ListNode* l) {
        ListNode* temp = l;
        while (temp->next != NULL) {
            temp = temp->next;
        }
        temp->next = new ListNode(0);
        return l;
    }

    ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {
        ListNode* t1 = l1;
        int n1 = 0;
        int n2 = 0;
        
        while (t1 != NULL) {
            t1 = t1->next;
            n1++;
        }
        ListNode* t2 = l2;
        while (t2 != NULL) {
            t2 = t2->next;
            n2++;
        }
        
        // Pad the shorter list with trailing zeros
        if (n1 < n2) {
            while (n1 != n2) {
                l1 = push_back(l1);
                n1++;
            }
        } else {
            while (n1 != n2) {
                l2 = push_back(l2);
                n2++;
            }
        }
        
        ListNode* newhead = NULL;
        ListNode* tail = NULL;
        t1 = l1;
        t2 = l2;
        int carry = 0; // Tracks overflows from previous additions

        while (t1 != NULL && t2 != NULL) {
            int t = t1->val + t2->val + carry; // Include carry from previous node
            
            if (t >= 10) {
                t -= 10;
                carry = 1; // Set carry for the next pair of nodes
            } else {
                carry = 0; // Reset carry if sum is safe
            }
            
            ListNode* newnode = new ListNode(t);
            if (newhead == NULL) {
                newhead = newnode;
                tail = newnode;
            } else {
                tail->next = newnode;
                tail = newnode;
            }
            t1 = t1->next;
            t2 = t2->next;
        }
        
        // If there's an extra carry left at the very end (e.g., 5+5=10)
        if (carry != 0) {
            tail->next = new ListNode(carry);
        }
        
        return newhead;               
    }
};

#[derive(Debug, Clone, PartialEq)]
pub enum Suit {
    Hearts,
    Diamonds,
    Clubs,
    Spades,
}

#[derive(Debug, Clone)]
pub struct Card {
    pub suit: Suit,
    pub value: u8, // 1 for Ace, 11 for Jack, etc.
}

use std::fmt;

impl fmt::Display for Suit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let suit_str = match self {
            Suit::Hearts => "hearts",
            Suit::Diamonds => "diamonds",
            Suit::Clubs => "clubs",
            Suit::Spades => "spades",
        };
        write!(f, "{}", suit_str)
    }
}


impl Card {
    pub fn new(suit: Suit, value: u8) -> Self {
        Self { suit, value }
    }

    pub fn name(&self) -> String {
        let value_name = match self.value {
            1 => "ace".to_string(),
            11 => "jack".to_string(),
            12 => "gueen".to_string(),
            13 => "king".to_string(),
            _ => self.value.to_string(),
        };
        format!("{}_{}", value_name, self.suit)
    }
}

use raylib::prelude::*;
use std::collections::HashMap;

/// Enum to track the current game state
enum GameState {
    StartScreen,
    Playing,
}

/// Struct to represent a card
type CardTextures = HashMap<String, Texture2D>;

/// Function to load all card images
fn load_card_textures(rl: &mut RaylibHandle, thread: &RaylibThread) -> CardTextures {
    let suits = ["hearts", "diamonds", "clubs", "spades"];
    let values = [
        "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace",
    ];
    let jokers = ["red_joker", "black_joker"];
    
    let mut textures = HashMap::new();
    
    for &suit in &suits {
        for &value in &values {
            let filename = format!("assets/{}_of_{}.png", value, suit);
            if let Ok(texture) = rl.load_texture(&thread, &filename) {
                textures.insert(format!("{}_{}", value, suit), texture);
            }
        }
    }
    
    for &joker in &jokers {
        let filename = format!("assets/{}.png", joker);
        if let Ok(texture) = rl.load_texture(&thread, &filename) {
            textures.insert(joker.to_string(), texture);
        }
    }
    
    textures
}

/// Function to initialize and run the game window
pub fn run_game_window() {
    let (mut rl, thread) = raylib::init()
        .size(800, 600)
        .title("Card Game")
        .build();

    let mut game_state = GameState::StartScreen;
    let card_textures = load_card_textures(&mut rl, &thread);

    while !rl.window_should_close() {
        let mouse_pos = rl.get_mouse_position();
        let mouse_clicked = rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_LEFT);

        let mut d = rl.begin_drawing(&thread);
        d.clear_background(Color::RAYWHITE);

        match game_state {
            GameState::StartScreen => {
                d.draw_text("Welcome to the Card Game!", 190, 150, 25, Color::DARKGRAY);

                let button_x = 300;
                let button_y = 300;
                let button_width = 200;
                let button_height = 50;

                let is_hovered = mouse_pos.x > button_x as f32
                    && mouse_pos.x < (button_x + button_width) as f32
                    && mouse_pos.y > button_y as f32
                    && mouse_pos.y < (button_y + button_height) as f32;

                let button_color = if is_hovered { Color::LIGHTGRAY } else { Color::GRAY };

                d.draw_rectangle(button_x, button_y, button_width, button_height, button_color);
                d.draw_text("Start Game", button_x + 40, button_y + 15, 20, Color::WHITE);

                if is_hovered && mouse_clicked {
                    game_state = GameState::Playing;
                }
            }
            GameState::Playing => {
                d.draw_text("Game in Progress...", 250, 50, 25, Color::DARKGRAY);
                
                // Example rendering of some cards
                let example_cards = vec!["10_hearts", "jack_spades", "queen_diamonds", "king_clubs"];
                let screen_width = d.get_screen_width();
                let screen_height = d.get_screen_height();
                let card_width = (screen_width as f32 * 0.1) as i32;
                let card_height = (screen_height as f32 * 0.2) as i32;
                
                for (i, card_key) in example_cards.iter().enumerate() {
                    if let Some(texture) = card_textures.get(&card_key.to_string()) {
                        let x = 100 + (i as i32) * (card_width + 20);
                        let y = screen_height - card_height - 50;
                        d.draw_texture_pro(
                            texture,
                            Rectangle { x: 0.0, y: 0.0, width: texture.width() as f32, height: texture.height() as f32 },
                            Rectangle { x: x as f32, y: y as f32, width: card_width as f32, height: card_height as f32 },
                            Vector2::new(0.0, 0.0),
                            0.0,
                            Color::WHITE,
                        );
                    }
                }
            }
        }
    }
}
